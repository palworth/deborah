import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { handleVaultSync } from "./backup";
import { setupD1 } from "../../test/setup-d1";

beforeEach(async () => {
  await setupD1();
});

function syncRequest(body: unknown, token = "vault-sync-test-token"): Request {
  return new Request("https://aftercall.test/vault/sync", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function b64(text: string): string {
  return btoa(text);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("handleVaultSync", () => {
  it("requires the vault sync bearer token", async () => {
    const res = await handleVaultSync(
      new Request("https://aftercall.test/vault/sync", { method: "POST" }),
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("backs up changed vault files to R2 and records a D1 manifest", async () => {
    const content = "# Deborah\n\nNotes\n";
    const res = await handleVaultSync(
      syncRequest({
        vault: "Pierce's workspace",
        device: "pierce-mbp",
        files: [
          {
            path: "Projects/Deborah.md",
            sha256: await sha256(content),
            size: 17,
            mtimeMs: 1777061000000,
            contentBase64: b64(content),
            contentType: "text/markdown; charset=utf-8",
          },
        ],
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      uploaded: 1,
      skipped: 0,
      deleted: 0,
    });

    const object = await env.VAULT_R2.get("vaults/pierce-s-workspace/files/Projects/Deborah.md");
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe("# Deborah\n\nNotes\n");

    const row = await env.DB
      .prepare(
        `SELECT vault_name, path, r2_key, sha256, size, mtime_ms, content_type, deleted_at
         FROM vault_files
         WHERE vault_name = ?1 AND path = ?2`,
      )
      .bind("Pierce's workspace", "Projects/Deborah.md")
      .first<{
        vault_name: string;
        path: string;
        r2_key: string;
        sha256: string;
        size: number;
        mtime_ms: number;
        content_type: string;
        deleted_at: string | null;
      }>();

    expect(row).toEqual({
      vault_name: "Pierce's workspace",
      path: "Projects/Deborah.md",
      r2_key: "vaults/pierce-s-workspace/files/Projects/Deborah.md",
      sha256: await sha256(content),
      size: 17,
      mtime_ms: 1777061000000,
      content_type: "text/markdown; charset=utf-8",
      deleted_at: null,
    });
  });

  it("skips unchanged files already present in the manifest", async () => {
    const content = "same note\n";
    const payload = {
      vault: "Pierce's workspace",
      files: [
        {
          path: "Inbox/2026-04-27.md",
          sha256: await sha256(content),
          size: 10,
          mtimeMs: 1,
          contentBase64: b64(content),
        },
      ],
    };

    expect((await handleVaultSync(syncRequest(payload), env)).status).toBe(200);
    const second = await handleVaultSync(syncRequest(payload), env);

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      uploaded: 0,
      skipped: 1,
      deleted: 0,
    });
  });

  it("marks deleted files as tombstoned and removes the R2 object", async () => {
    const content = "old\n";
    await handleVaultSync(
      syncRequest({
        vault: "Pierce's workspace",
        files: [
          {
            path: "Inbox/Old.md",
            sha256: await sha256(content),
            size: 4,
            mtimeMs: 1,
            contentBase64: b64(content),
          },
        ],
      }),
      env,
    );

    const res = await handleVaultSync(
      syncRequest({
        vault: "Pierce's workspace",
        deleted: [{ path: "Inbox/Old.md", mtimeMs: 2 }],
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deleted: 1 });
    await expect(env.VAULT_R2.get("vaults/pierce-s-workspace/files/Inbox/Old.md")).resolves.toBeNull();

    const row = await env.DB
      .prepare("SELECT deleted_at FROM vault_files WHERE vault_name = ?1 AND path = ?2")
      .bind("Pierce's workspace", "Inbox/Old.md")
      .first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeTruthy();
  });

  it("rejects unsafe vault paths", async () => {
    const res = await handleVaultSync(
      syncRequest({
        vault: "Pierce's workspace",
        files: [
          {
            path: "../secrets.md",
            sha256: "3".repeat(64),
            size: 6,
            mtimeMs: 1,
            contentBase64: b64("nope\n"),
          },
        ],
      }),
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Unsafe path");
  });
});
