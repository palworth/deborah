#!/usr/bin/env node
/**
 * Write a Codex-organized notes dump into a local Obsidian vault.
 *
 * Best path:
 *   1. Codex turns a messy dump into the JSON IntakePlan shape below.
 *   2. This script performs the boring, safe file writes.
 *
 *   OBSIDIAN_VAULT="$HOME/Documents/My Vault" \
 *   npm run notes:intake -- --plan /tmp/intake-plan.json
 *
 * Plain text fallback:
 *   echo "messy notes..." | npm run notes:intake -- --vault "$OBSIDIAN_VAULT" --title "Brain dump"
 */
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { stdin } from "node:process";
import { parseArgs } from "node:util";
import {
  buildBootstrapDocuments,
  buildIntakeDocuments,
  type IntakeDocument,
  type IntakePlan,
} from "../src/obsidian/intake.ts";

interface WriteResult {
  path: string;
  action: "created" | "appended" | "skipped";
}

const { values } = parseArgs({
  options: {
    vault: { type: "string" },
    plan: { type: "string" },
    dump: { type: "string" },
    title: { type: "string" },
    bootstrap: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const vaultPath = values.vault ?? process.env.OBSIDIAN_VAULT ?? (await detectObsidianVault());
  if (!vaultPath) {
    fail("Set --vault or OBSIDIAN_VAULT to your local Obsidian vault path.");
  }

  const vault = resolve(expandHome(vaultPath));
  await ensureDirectory(vault, "Obsidian vault");

  const docs = values.bootstrap
    ? buildBootstrapDocuments()
    : buildIntakeDocuments(await loadPlan());

  if (values["dry-run"]) {
    console.log(JSON.stringify({ dryRun: true, vault, documents: docs }, null, 2));
    return;
  }

  const results: WriteResult[] = [];
  for (const doc of docs) {
    results.push(await writeDocument(vault, doc));
  }

  console.log(JSON.stringify({ vault, results }, null, 2));
}

async function loadPlan(): Promise<IntakePlan> {
  if (values.plan) {
    const raw = await readFile(expandHome(values.plan), "utf8");
    return validatePlan(JSON.parse(raw));
  }

  const dump = values.dump
    ? await readFile(expandHome(values.dump), "utf8")
    : await readStdin();

  if (!dump.trim()) {
    fail("Provide --plan, --dump, or pipe raw notes into stdin.");
  }

  return {
    title: values.title,
    dump,
  };
}

async function writeDocument(vault: string, doc: IntakeDocument): Promise<WriteResult> {
  const target = resolveInsideVault(vault, doc.path);
  await mkdir(dirname(target), { recursive: true });

  if (doc.mode === "create") {
    if (await exists(target)) return { path: doc.path, action: "skipped" };
    await writeFile(target, ensureTrailingNewline(doc.createContent), "utf8");
    return { path: doc.path, action: "created" };
  }

  if (await exists(target)) {
    await appendFile(target, ensureLeadingNewline(doc.appendContent ?? ""), "utf8");
    return { path: doc.path, action: "appended" };
  }

  await writeFile(target, ensureTrailingNewline(doc.createContent), "utf8");
  return { path: doc.path, action: "created" };
}

function validatePlan(value: unknown): IntakePlan {
  if (!value || typeof value !== "object") fail("Plan JSON must be an object.");
  const plan = value as Partial<IntakePlan>;
  if (typeof plan.dump !== "string" || !plan.dump.trim()) {
    fail("Plan JSON must include a non-empty string field: dump.");
  }
  return plan as IntakePlan;
}

async function readStdin(): Promise<string> {
  if (stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
  const configPath = join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
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
