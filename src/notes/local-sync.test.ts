import { describe, expect, it, vi } from "vitest";
import { syncNoteInboxToObsidian } from "./local-sync";

describe("syncNoteInboxToObsidian", () => {
  it("pulls pending note inbox items, writes Obsidian documents, then acks them", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/notes/pending?limit=25")) {
        return Response.json({
          notes: [
            {
              id: "note_1",
              intakePlan: {
                title: "Voice dump",
                dump: "I need Deborah to organize dictated notes.",
                tasks: [{ text: "Design note sync workflow", project: "Deborah" }],
              },
            },
          ],
        });
      }
      if (href.endsWith("/notes/note_1/synced") && init?.method === "POST") {
        return Response.json({ ok: true, id: "note_1" });
      }
      return new Response("not found", { status: 404 });
    });
    const writePlan = vi.fn(async () => ({
      paths: ["Inbox/2026-04-28.md", "Next Actions.md"],
    }));

    const result = await syncNoteInboxToObsidian({
      baseUrl: "https://aftercall.test",
      token: "secret",
      fetch: fetchMock,
      writePlan,
      now: new Date(2026, 3, 28, 9, 30, 0),
      device: "test-device",
    });

    expect(result.synced).toBe(1);
    expect(result.notes[0].id).toBe("note_1");
    expect(result.notes[0].paths).toEqual(
      expect.arrayContaining(["Inbox/2026-04-28.md", "Next Actions.md"]),
    );

    expect(writePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Voice dump",
        dump: "I need Deborah to organize dictated notes.",
      }),
      { now: new Date(2026, 3, 28, 9, 30, 0) },
    );

    const ackBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(ackBody).toMatchObject({
      device: "test-device",
      paths: expect.arrayContaining(["Inbox/2026-04-28.md", "Next Actions.md"]),
    });
  });
});
