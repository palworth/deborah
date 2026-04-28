#!/usr/bin/env node
/**
 * Back up a local Obsidian vault to Deborah's Cloudflare Worker.
 *
 * The Worker stores file bodies in R2 and a manifest in D1. This script keeps
 * a tiny local state file under ~/.deborah so repeated runs only upload changed
 * files and tombstone deleted ones.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

interface StateEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
}

interface BackupState {
  vaultPath: string;
  vaultName: string;
  updatedAt: string;
  files: Record<string, StateEntry>;
}

interface ScannedFile extends StateEntry {
  path: string;
  absolutePath: string;
  contentType: string;
}

interface BatchFile extends StateEntry {
  path: string;
  contentBase64: string;
  contentType: string;
}

const { values } = parseArgs({
  options: {
    vault: { type: "string" },
    url: { type: "string" },
    token: { type: "string" },
    "batch-size": { type: "string", default: "20" },
    "max-file-bytes": { type: "string", default: String(5 * 1024 * 1024) },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const vault = resolve(expandHome(values.vault ?? process.env.OBSIDIAN_VAULT ?? (await detectObsidianVault()) ?? ""));
  if (!vault) fail("Set --vault or OBSIDIAN_VAULT to your local Obsidian vault path.");
  await ensureDirectory(vault, "Obsidian vault");

  const baseUrl = (values.url ?? process.env.DEBORAH_WORKER_URL ?? process.env.BASE_URL ?? "").replace(/\/$/, "");
  if (!baseUrl && !values["dry-run"]) fail("Set --url, DEBORAH_WORKER_URL, or BASE_URL.");

  const token =
    values.token ??
    process.env.VAULT_SYNC_TOKEN ??
    process.env.VAULT_SYNC_SECRET ??
    (await readLocalToken()) ??
    "";
  if (!token && !values["dry-run"]) fail("Set --token, VAULT_SYNC_TOKEN, or VAULT_SYNC_SECRET.");

  const batchSize = positiveInt(values["batch-size"] ?? "20", "batch-size");
  const maxFileBytes = positiveInt(values["max-file-bytes"] ?? String(5 * 1024 * 1024), "max-file-bytes");
  const vaultName = basename(vault);
  const statePath = stateFilePath(vault);
  const previous = await readState(statePath, vault, vaultName);
  const scanned = await scanVault(vault, maxFileBytes);
  const current = Object.fromEntries(scanned.map((file) => [file.path, file]));
  const changed = scanned.filter((file) => {
    const old = previous.files[file.path];
    return !old || old.sha256 !== file.sha256 || old.size !== file.size || old.mtimeMs !== file.mtimeMs;
  });
  const deleted = Object.keys(previous.files)
    .filter((path) => !current[path])
    .map((path) => ({ path, mtimeMs: Date.now() }));

  console.log(`Vault:          ${vault}`);
  console.log(`Worker URL:     ${baseUrl || "(dry run)"}`);
  console.log(`Scanned files:  ${scanned.length}`);
  console.log(`Changed files:  ${changed.length}`);
  console.log(`Deleted files:  ${deleted.length}`);
  console.log("");

  if (values["dry-run"]) {
    console.log(JSON.stringify({ changed: changed.map((f) => f.path), deleted }, null, 2));
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  let removed = 0;
  for (let i = 0; i < changed.length; i += batchSize) {
    const batch = changed.slice(i, i + batchSize);
    const files: BatchFile[] = [];
    for (const file of batch) {
      const content = await readFile(file.absolutePath);
      files.push({
        path: file.path,
        sha256: file.sha256,
        size: file.size,
        mtimeMs: file.mtimeMs,
        contentType: file.contentType,
        contentBase64: content.toString("base64"),
      });
    }
    const result = await sendBatch(baseUrl, token, {
      vault: vaultName,
      device: deviceName(),
      batchId: randomUUID(),
      files,
    });
    uploaded += result.uploaded;
    skipped += result.skipped;
  }

  for (let i = 0; i < deleted.length; i += batchSize) {
    const batch = deleted.slice(i, i + batchSize);
    const result = await sendBatch(baseUrl, token, {
      vault: vaultName,
      device: deviceName(),
      batchId: randomUUID(),
      deleted: batch,
    });
    removed += result.deleted;
  }

  await writeState(statePath, {
    vaultPath: vault,
    vaultName,
    updatedAt: new Date().toISOString(),
    files: Object.fromEntries(scanned.map((file) => [file.path, {
      sha256: file.sha256,
      size: file.size,
      mtimeMs: file.mtimeMs,
    }])),
  });

  console.log(JSON.stringify({ uploaded, skipped, deleted: removed, statePath }, null, 2));
}

async function sendBatch(
  baseUrl: string,
  token: string,
  body: unknown,
): Promise<{ uploaded: number; skipped: number; deleted: number }> {
  const res = await fetch(`${baseUrl}/vault/sync`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Vault sync failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as { uploaded: number; skipped: number; deleted: number };
}

async function scanVault(vault: string, maxFileBytes: number): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolutePath);
      if (info.size > maxFileBytes) continue;
      const content = await readFile(absolutePath);
      const path = relative(vault, absolutePath).split(sep).join("/");
      files.push({
        path,
        absolutePath,
        sha256: createHash("sha256").update(content).digest("hex"),
        size: info.size,
        mtimeMs: Math.round(info.mtimeMs),
        contentType: contentTypeFor(path),
      });
    }
  }
  await visit(vault);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function shouldIgnore(name: string): boolean {
  return [
    ".obsidian",
    ".git",
    ".trash",
    ".deborah",
    ".DS_Store",
  ].includes(name);
}

async function readState(path: string, vaultPath: string, vaultName: string): Promise<BackupState> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as BackupState;
  } catch {
    return { vaultPath, vaultName, updatedAt: "", files: {} };
  }
}

async function writeState(path: string, state: BackupState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function stateFilePath(vaultPath: string): string {
  const id = createHash("sha256").update(vaultPath).digest("hex").slice(0, 16);
  return join(homedir(), ".deborah", "vault-backup-state", `${id}.json`);
}

async function detectObsidianVault(): Promise<string | undefined> {
  const configPath = join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      vaults?: Record<string, { path?: string; ts?: number; open?: boolean }>;
    };
    return Object.values(config.vaults ?? {})
      .filter((vault): vault is { path: string; ts?: number; open?: boolean } => Boolean(vault.path))
      .sort((a, b) => {
        if (a.open !== b.open) return a.open ? -1 : 1;
        return (b.ts ?? 0) - (a.ts ?? 0);
      })[0]?.path;
  } catch {
    return undefined;
  }
}

async function readLocalToken(): Promise<string | undefined> {
  try {
    return (await readFile(join(homedir(), ".deborah", "vault-sync-token"), "utf8")).trim();
  } catch {
    return undefined;
  }
}

async function ensureDirectory(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    fail(`${label} does not exist or is not readable: ${path}`);
  }
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${label} must be a positive integer.`);
  return parsed;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function deviceName(): string {
  return process.env.HOSTNAME || process.env.COMPUTERNAME || "local";
}

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
