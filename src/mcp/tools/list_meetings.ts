import type { Env } from "../../env";
import type { ToolResult } from "./recent_calls";

export interface ListMeetingsInput {
  series: string;
  from?: string;
  to?: string;
  limit?: number;
}

interface Row {
  video_id: string;
  title: string;
  created_at: string;
  local_date: string | null;
  meeting_series: string | null;
  summary: string | null;
}

function buildDateClause(input: ListMeetingsInput, bindings: Array<string | number>): string {
  const clauses: string[] = [];
  if (input.from) {
    bindings.push(input.from);
    clauses.push(`COALESCE(t.local_date, substr(t.created_at, 1, 10)) >= ?${bindings.length}`);
  }
  if (input.to) {
    bindings.push(input.to);
    clauses.push(`COALESCE(t.local_date, substr(t.created_at, 1, 10)) <= ?${bindings.length}`);
  }
  return clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
}

export async function listMeetings(
  input: ListMeetingsInput,
  env: Env,
): Promise<ToolResult> {
  const series = input.series.trim();
  if (!series) {
    return { content: [{ type: "text", text: "Missing `series` argument." }] };
  }

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const bindings: Array<string | number> = [series.toLowerCase()];
  const dateClause = buildDateClause(input, bindings);
  bindings.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT t.video_id, t.title, t.created_at, t.local_date, t.meeting_series, t.summary
     FROM transcripts t
     WHERE LOWER(COALESCE(t.meeting_series, '')) = ?1
     ${dateClause}
     ORDER BY COALESCE(t.local_date, substr(t.created_at, 1, 10)) ASC, t.created_at ASC, t.id ASC
     LIMIT ?${bindings.length}`,
  )
    .bind(...bindings)
    .all<Row>();

  if (!results || results.length === 0) {
    const range = input.from || input.to ? ` from ${input.from ?? "beginning"} to ${input.to ?? "now"}` : "";
    return {
      content: [{ type: "text", text: `No ${series} meetings found${range}.` }],
    };
  }

  const lines = results.map((row) => {
    const date = row.local_date ?? row.created_at.slice(0, 10);
    const snippet = row.summary
      ? ` — ${row.summary.slice(0, 120).replace(/\s+/g, " ")}${row.summary.length > 120 ? "..." : ""}`
      : "";
    return `• [${date}] ${row.title} (\`${row.video_id}\`)${snippet}`;
  });

  return {
    content: [
      {
        type: "text",
        text: `Found ${results.length} ${series} meeting${results.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}`,
      },
    ],
  };
}
