import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { setupD1 } from "../../../test/setup-d1";
import { listMeetings } from "./list_meetings";

async function seed(row: {
  videoId: string;
  title: string;
  createdAt: string;
  localDate?: string;
  meetingSeries?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO transcripts
       (video_id, title, raw_text, summary, action_items, created_at, local_date, meeting_series)
     VALUES (?1, ?2, 'raw', 'summary', '[]', ?3, ?4, ?5)`,
  )
    .bind(
      row.videoId,
      row.title,
      row.createdAt,
      row.localDate ?? null,
      row.meetingSeries ?? null,
    )
    .run();
}

describe("listMeetings", () => {
  beforeEach(async () => {
    await setupD1();
  });

  it("lists meetings by series and local date range", async () => {
    await seed({
      videoId: "meet.google.com/apr-21",
      title: "Leadership Team Daily Sync",
      createdAt: "2026-04-21 22:00:00",
      localDate: "2026-04-21",
      meetingSeries: "HTS",
    });
    await seed({
      videoId: "meet.google.com/apr-22",
      title: "Leadership Team Daily Sync",
      createdAt: "2026-04-23 00:09:12",
      localDate: "2026-04-22",
      meetingSeries: "HTS",
    });
    await seed({
      videoId: "meet.google.com/forecasting",
      title: "Forecasting daily sync",
      createdAt: "2026-04-22 18:00:00",
      localDate: "2026-04-22",
      meetingSeries: "Forecasting",
    });

    const out = await listMeetings(
      { series: "HTS", from: "2026-04-21", to: "2026-04-22" },
      env,
    );
    const text = out.content[0].text;

    expect(text).toContain("[2026-04-21] Leadership Team Daily Sync");
    expect(text).toContain("[2026-04-22] Leadership Team Daily Sync");
    expect(text).toContain("meet.google.com/apr-22");
    expect(text).not.toContain("Forecasting daily sync");
  });

  it("falls back to created_at date when local_date is not populated", async () => {
    await seed({
      videoId: "meet.google.com/no-local-date",
      title: "HTS Meet",
      createdAt: "2026-04-27 00:33:43",
      meetingSeries: "HTS",
    });

    const out = await listMeetings(
      { series: "HTS", from: "2026-04-27", to: "2026-04-27" },
      env,
    );

    expect(out.content[0].text).toContain("HTS Meet");
  });
});
