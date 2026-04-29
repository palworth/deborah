#!/usr/bin/env node
/**
 * Pull Deborah note inbox items from Cloudflare and write them into a local
 * Obsidian vault. Cloudflare is the queue; this script is the local filesystem
 * hand that can safely touch the vault.
 */
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { buildIntakeDocuments, type IntakeDocument, type IntakePlan } from "../src/obsidian/intake.ts";
import { syncNoteInboxToObsidian } from "../src/notes/local-sync.ts";

interface WriteResult {
  paths: string[];
}

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    vault: { type: "string" },
    token: { type: "string" },
    limit: { type: "string" },
    device: { type: "string" },
  },
});

async function main(): Promise<void> {
  const baseUrl = values.url ?? process.env.DEBORAH_WORKER_URL ?? process.env.BASE_URL;
  if (!baseUrl) fail("Set --url, DEBORAH_WORKER_URL, or BASE_URL.");

  const token =
    values.token ??
    process.env.VAULT_SYNC_TOKEN ??
    process.env.VAULT_SYNC_SECRET ??
    (await readTokenFile());
  if (!token) fail("Set --token, VAULT_SYNC_TOKEN, or VAULT_SYNC_SECRET.");

  const vaultPath = values.vault ?? process.env.OBSIDIAN_VAULT ?? (await detectObsidianVault());
  if (!vaultPath) fail("Set --vault or OBSIDIAN_VAULT to your local Obsidian vault path.");

  const vault = resolve(expandHome(vaultPath));
  await ensureDirectory(vault, "Obsidian vault");

  const result = await syncNoteInboxToObsidian({
    baseUrl,
    token,
    limit: values.limit ? Number(values.limit) : undefined,
    device: values.device ?? hostname(),
    writePlan: (plan, options) => writePlanToVault(vault, plan, options),
  });

  console.log(JSON.stringify(result, null, 2));
}

async function writePlanToVault(
  vault: string,
  plan: IntakePlan,
  options: { now?: Date },
): Promise<WriteResult> {
  const docs = buildIntakeDocuments(plan, { now: options.now });
  const paths: string[] = [];
  for (const doc of docs) {
    await writeDocument(vault, doc);
    paths.push(doc.path);
  }
  return { paths };
}

async function writeDocument(vault: string, doc: IntakeDocument): Promise<void> {
  const target = resolveInsideVault(vault, doc.path);
  await mkdir(dirname(target), { recursive: true });

  if (doc.mode === "create") {
    if (await exists(target)) return;
    await writeFile(target, ensureTrailingNewline(doc.createContent), "utf8");
    return;
  }

  if (await exists(target)) {
    await appendFile(target, ensureLeadingNewline(doc.appendContent ?? ""), "utf8");
    return;
  }

  await writeFile(target, ensureTrailingNewline(doc.createContent), "utf8");
}

async function ensureDirectory(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.R_OK | constants.W_OK);
  } catch {
    fail(`${label} does not exist or is not writable: ${path}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveInsideVault(vault: string, relativePath: string): string {
  if (isAbsolute(relativePath)) fail(`Document paths must be vault-relative: ${relativePath}`);
  const target = resolve(vault, relativePath);
  if (target !== vault && !target.startsWith(`${vault}${sep}`)) {
    fail(`Document path escapes the vault: ${relativePath}`);
  }
  return target;
}

function expandHome(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return join(process.env.HOME ?? "", path.slice(2));
  return path;
}

async function detectObsidianVault(): Promise<string | undefined> {
  const configPath = join(process.env.HOME ?? "", "Library", "Application Support", "obsidian", "obsidian.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      vaults?: Record<string, { path?: string; ts?: number; open?: boolean }>;
    };
    const vaults = Object.values(config.vaults ?? {})
      .filter((vault): vault is { path: string; ts?: number; open?: boolean } => Boolean(vault.path))
      .sort((a, b) => {
        if (a.open !== b.open) return a.open ? -1 : 1;
        return (b.ts ?? 0) - (a.ts ?? 0);
      });
    return vaults[0]?.path;
  } catch {
    return undefined;
  }
}

async function readTokenFile(): Promise<string | undefined> {
  try {
    return (await readFile(join(process.env.HOME ?? "", ".deborah", "vault-sync-token"), "utf8")).trim();
  } catch {
    return undefined;
  }
}

function ensureLeadingNewline(content: string): string {
  const withTrailing = ensureTrailingNewline(content);
  return withTrailing.startsWith("\n") ? withTrailing : `\n${withTrailing}`;
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
