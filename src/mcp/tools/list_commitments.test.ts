import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { setupD1 } from "../../../test/setup-d1";
import { listCommitments } from "./list_commitments";

async function seed(row: {
  videoId: string;
  title: string;
  createdAt: string;
  localDate: string;
  meetingSeries: string;
  rawText?: string | null;
  actionItems?: unknown[];
}) {
  await env.DB.prepare(
    `INSERT INTO transcripts
       (video_id, title, raw_text, summary, action_items, created_at, local_date, meeting_series)
     VALUES (?1, ?2, ?3, 'summary', ?4, ?5, ?6, ?7)`,
  )
    .bind(
      row.videoId,
      row.title,
      row.rawText ?? "raw",
      JSON.stringify(row.actionItems ?? []),
      row.createdAt,
      row.localDate,
      row.meetingSeries,
    )
    .run();
}

describe("listCommitments", () => {
  beforeEach(async () => {
    await setupD1();
  });

  it("lists matching commitments by meeting series, local date range, and owner", async () => {
    await seed({
      videoId: "meet.google.com/hts",
      title: "Leadership Team Daily Sync",
      createdAt: "2026-04-23 00:09:12",
      localDate: "2026-04-22",
      meetingSeries: "HTS",
      actionItems: [
        { task: "Send updated vendor list", owner: "Pierce Alworth", due_date: "2026-04-24" },
        { task: "Review designs", owner: "Katarina" },
      ],
    });
    await seed({
      videoId: "meet.google.com/forecasting",
      title: "Forecasting daily sync",
      createdAt: "2026-04-23 00:30:00",
      localDate: "2026-04-22",
      meetingSeries: "Forecasting",
      actionItems: [{ task: "Update forecast", owner: "Pierce Alworth" }],
    });

    const out = await listCommitments(
      {
        series: "HTS",
        from: "2026-04-22",
        to: "2026-04-22",
        person: "Pierce",
      },
      env,
    );
    const text = out.content[0].text;

    expect(text).toContain("Send updated vendor list");
    expect(text).toContain("due 2026-04-24");
    expect(text).not.toContain("Review designs");
    expect(text).not.toContain("Update forecast");
  });

  it("calls out matched meetings that have raw transcripts but no extracted action items", async () => {
    await seed({
      videoId: "backfill:leadership-team-daily-sync",
      title: "Leadership Team Daily Sync",
      createdAt: "2026-04-21 12:00:00",
      localDate: "2026-04-21",
      meetingSeries: "HTS",
      rawText: "Pierce: I will follow up on permitting.",
      actionItems: [],
    });

    const out = await listCommitments(
      {
        series: "HTS",
        from: "2026-04-21",
        to: "2026-04-21",
        person: "Pierce",
      },
      env,
    );
    const text = out.content[0].text;

    expect(text).toContain("No extracted commitments found");
    expect(text).toContain("1 matched meeting has a raw transcript but no extracted action items yet");
    expect(text).toContain("Leadership Team Daily Sync");
  });
});
