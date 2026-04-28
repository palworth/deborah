import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { setupD1 } from "../../test/setup-d1";
import {
  captureThought,
  handleListPendingNotes,
  handleMarkNoteSynced,
} from "./inbox";

beforeEach(async () => {
  await setupD1();
});

function authedRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer vault-sync-test-token",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("note inbox", () => {
  it("captures a structured thought as a pending Obsidian intake plan", async () => {
    const result = await captureThought(
      {
        title: "Deborah sync workflow",
        dump: "Need a local sync agent that writes organized notes into Obsidian.",
        summary: "Hybrid Cloudflare plus local Obsidian sync is the preferred workflow.",
        tags: ["deborah", "workflow"],
        projects: [
          {
            name: "Deborah",
            status: "active",
            nextActions: ["Build notes inbox sync"],
          },
        ],
        tasks: [
          {
            text: "Build notes inbox sync",
            project: "Deborah",
            priority: "high",
          },
        ],
      },
      env,
      { id: () => "note_test_1", now: () => "2026-04-28 05:00:00" },
    );

    expect(result.content[0].text).toContain("Captured thought");
    expect(result.content[0].text).toContain("note_test_1");

    const row = await env.DB
      .prepare("SELECT id, status, source, title, intake_plan FROM note_inbox WHERE id = ?1")
      .bind("note_test_1")
      .first<{
        id: string;
        status: string;
        source: string;
        title: string;
        intake_plan: string;
      }>();

    expect(row).toMatchObject({
      id: "note_test_1",
      status: "pending",
      source: "mcp",
      title: "Deborah sync workflow",
    });
    expect(JSON.parse(row!.intake_plan)).toMatchObject({
      title: "Deborah sync workflow",
      dump: "Need a local sync agent that writes organized notes into Obsidian.",
      projects: [{ name: "Deborah" }],
    });
  });

  it("lists pending notes for the local Obsidian sync agent", async () => {
    await captureThought({ title: "First", dump: "one" }, env, {
      id: () => "note_1",
      now: () => "2026-04-28 05:00:00",
    });
    await captureThought({ title: "Second", dump: "two" }, env, {
      id: () => "note_2",
      now: () => "2026-04-28 05:01:00",
    });

    const res = await handleListPendingNotes(
      authedRequest("https://aftercall.test/notes/pending?limit=1"),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      notes: [
        {
          id: "note_1",
          status: "pending",
          intakePlan: { title: "First", dump: "one" },
        },
      ],
    });
  });

  it("marks a pending note as synced after local Obsidian writes succeed", async () => {
    await captureThought({ title: "Done", dump: "synced" }, env, {
      id: () => "note_done",
      now: () => "2026-04-28 05:00:00",
    });

    const res = await handleMarkNoteSynced(
      authedRequest("https://aftercall.test/notes/note_done/synced", {
        method: "POST",
        body: JSON.stringify({
          device: "pierce-mbp",
          paths: ["Inbox/2026-04-28.md", "Projects/Deborah.md"],
        }),
      }),
      env,
      { now: () => "2026-04-28 05:05:00" },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, id: "note_done" });

    const row = await env.DB
      .prepare("SELECT status, sync_device, obsidian_paths, synced_at FROM note_inbox WHERE id = ?1")
      .bind("note_done")
      .first<{
        status: string;
        sync_device: string;
        obsidian_paths: string;
        synced_at: string;
      }>();

    expect(row).toEqual({
      status: "synced",
      sync_device: "pierce-mbp",
      obsidian_paths: JSON.stringify(["Inbox/2026-04-28.md", "Projects/Deborah.md"]),
      synced_at: "2026-04-28 05:05:00",
    });
  });

  it("rejects local sync requests without the bearer secret", async () => {
    const res = await handleListPendingNotes(
      new Request("https://aftercall.test/notes/pending"),
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });
});
