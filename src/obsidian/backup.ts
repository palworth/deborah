import type { Env } from "../env";
import { log } from "../logger";

interface VaultFileInput {
  path: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  contentBase64: string;
  contentType?: string;
}

interface VaultDeletedInput {
  path: string;
  mtimeMs?: number;
}

interface VaultSyncInput {
  vault: string;
  device?: string;
  batchId?: string;
  files?: VaultFileInput[];
  deleted?: VaultDeletedInput[];
}

interface ExistingFile {
  sha256: string | null;
  size: number;
  mtime_ms: number;
  deleted_at: string | null;
}

const MAX_FILES_PER_BATCH = 100;

export async function handleVaultSync(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!env.VAULT_SYNC_SECRET || !token || token !== env.VAULT_SYNC_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let input: VaultSyncInput;
  try {
    input = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const vault = input.vault?.trim();
  if (!vault) return new Response("Missing vault", { status: 400 });

  const files = input.files ?? [];
  const deleted = input.deleted ?? [];
  if (files.length + deleted.length === 0) {
    return new Response("No files provided", { status: 400 });
  }
  if (files.length + deleted.length > MAX_FILES_PER_BATCH) {
    return new Response(`Too many files; max ${MAX_FILES_PER_BATCH}`, { status: 413 });
  }

  for (const file of files) {
    const unsafe = unsafePathReason(file.path);
    if (unsafe) return new Response(`Unsafe path: ${file.path}`, { status: 400 });
    if (!isSha256(file.sha256)) return new Response(`Invalid sha256 for ${file.path}`, { status: 400 });
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      return new Response(`Invalid size for ${file.path}`, { status: 400 });
    }
    if (!Number.isSafeInteger(file.mtimeMs) || file.mtimeMs < 0) {
      return new Response(`Invalid mtimeMs for ${file.path}`, { status: 400 });
    }
  }
  for (const item of deleted) {
    const unsafe = unsafePathReason(item.path);
    if (unsafe) return new Response(`Unsafe path: ${item.path}`, { status: 400 });
  }

  const batchId = input.batchId?.trim() || crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO vault_sync_batches (id, vault_name, device_id)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(batchId, vault, input.device ?? null)
    .run();

  let uploaded = 0;
  let skipped = 0;
  let removed = 0;
  const vaultSlug = slugifyVault(vault);

  for (const file of files) {
    const existing = await env.DB
      .prepare(
        `SELECT sha256, size, mtime_ms, deleted_at
         FROM vault_files
         WHERE vault_name = ?1 AND path = ?2`,
      )
      .bind(vault, file.path)
      .first<ExistingFile>();

    if (
      existing &&
      existing.sha256 === file.sha256 &&
      existing.size === file.size &&
      existing.mtime_ms === file.mtimeMs &&
      existing.deleted_at == null
    ) {
      skipped++;
      continue;
    }

    const bytes = decodeBase64(file.contentBase64);
    if (bytes.byteLength !== file.size) {
      return new Response(`Content size mismatch for ${file.path}`, { status: 400 });
    }
    const actualSha = await sha256Hex(bytes);
    if (actualSha !== file.sha256) {
      return new Response(`Content hash mismatch for ${file.path}`, { status: 400 });
    }

    const r2Key = r2KeyFor(vaultSlug, file.path);
    await env.VAULT_R2.put(r2Key, bytes, {
      httpMetadata: { contentType: file.contentType || contentTypeFor(file.path) },
      customMetadata: {
        vault,
        path: file.path,
        sha256: file.sha256,
        mtimeMs: String(file.mtimeMs),
      },
    });

    await env.DB
      .prepare(
        `INSERT INTO vault_files
           (vault_name, path, r2_key, sha256, size, mtime_ms, content_type, deleted_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, datetime('now'))
         ON CONFLICT(vault_name, path) DO UPDATE SET
           r2_key = excluded.r2_key,
           sha256 = excluded.sha256,
           size = excluded.size,
           mtime_ms = excluded.mtime_ms,
           content_type = excluded.content_type,
           deleted_at = NULL,
           updated_at = datetime('now')`,
      )
      .bind(
        vault,
        file.path,
        r2Key,
        file.sha256,
        file.size,
        file.mtimeMs,
        file.contentType || contentTypeFor(file.path),
      )
      .run();
    uploaded++;
  }

  for (const item of deleted) {
    const r2Key = r2KeyFor(vaultSlug, item.path);
    await env.VAULT_R2.delete(r2Key);
    await env.DB
      .prepare(
        `INSERT INTO vault_files
           (vault_name, path, r2_key, sha256, size, mtime_ms, content_type, deleted_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, 0, ?4, NULL, datetime('now'), datetime('now'))
         ON CONFLICT(vault_name, path) DO UPDATE SET
           deleted_at = datetime('now'),
           updated_at = datetime('now')`,
      )
      .bind(vault, item.path, r2Key, item.mtimeMs ?? Date.now())
      .run();
    removed++;
  }

  await env.DB
    .prepare(
      `UPDATE vault_sync_batches
       SET completed_at = datetime('now'),
           files_uploaded = ?1,
           files_skipped = ?2,
           files_deleted = ?3
       WHERE id = ?4`,
    )
    .bind(uploaded, skipped, removed, batchId)
    .run();

  log("info", "vault_sync_completed", {
    vault,
    batch_id: batchId,
    uploaded,
    skipped,
    deleted: removed,
  });

  return Response.json({
    ok: true,
    batchId,
    uploaded,
    skipped,
    deleted: removed,
  });
}

function unsafePathReason(path: string): string | null {
  if (!path || path.startsWith("/") || path.includes("\0")) return "empty_or_absolute";
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return "relative_segment";
  return null;
}

function r2KeyFor(vaultSlug: string, path: string): string {
  return `vaults/${vaultSlug}/files/${path}`;
}

function slugifyVault(vault: string): string {
  return vault
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "vault";
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function decodeBase64(input: string): Uint8Array {
  const raw = atob(input);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
