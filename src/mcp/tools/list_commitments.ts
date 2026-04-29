import type { Env } from "../../env";
import type { ToolResult } from "./recent_calls";

export interface ListCommitmentsInput {
  series: string;
  from?: string;
  to?: string;
  person?: string;
  limit?: number;
}

interface CommitmentRow {
  video_id: string;
  title: string;
  created_at: string;
  local_date: string | null;
  task: string;
  owner: string | null;
  due_date: string | null;
}

interface UnextractedRow {
  video_id: string;
  title: string;
  created_at: string;
  local_date: string | null;
}

function appendFilters(
  input: ListCommitmentsInput,
  bindings: Array<string | number>,
): string {
  const clauses: string[] = [];
  if (input.from) {
    bindings.push(input.from);
    clauses.push(`COALESCE(t.local_date, substr(t.created_at, 1, 10)) >= ?${bindings.length}`);
  }
  if (input.to) {
    bindings.push(input.to);
    clauses.push(`COALESCE(t.local_date, substr(t.created_at, 1, 10)) <= ?${bindings.length}`);
  }
  if (input.person?.trim()) {
    bindings.push(`%${input.person.trim().toLowerCase()}%`);
    clauses.push(`LOWER(COALESCE(json_extract(ai.value, '$.owner'), '')) LIKE ?${bindings.length}`);
  }
  return clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
}

function appendUnextractedFilters(
  input: ListCommitmentsInput,
  bindings: Array<string | number>,
): string {
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

export async function listCommitments(
  input: ListCommitmentsInput,
  env: Env,
): Promise<ToolResult> {
  const series = input.series.trim();
  if (!series) {
    return { content: [{ type: "text", text: "Missing `series` argument." }] };
  }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const bindings: Array<string | number> = [series.toLowerCase()];
  const filters = appendFilters(input, bindings);
  bindings.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT
       t.video_id,
       t.title,
       t.created_at,
       t.local_date,
       json_extract(ai.value, '$.task') AS task,
       json_extract(ai.value, '$.owner') AS owner,
       json_extract(ai.value, '$.due_date') AS due_date
     FROM transcripts t, json_each(t.action_items) ai
     WHERE LOWER(COALESCE(t.meeting_series, '')) = ?1
     ${filters}
     ORDER BY COALESCE(t.local_date, substr(t.created_at, 1, 10)) ASC, t.created_at ASC, t.id ASC
     LIMIT ?${bindings.length}`,
  )
    .bind(...bindings)
    .all<CommitmentRow>();

  const unextractedBindings: Array<string | number> = [series.toLowerCase()];
  const unextractedFilters = appendUnextractedFilters(input, unextractedBindings);
  const { results: unextracted } = await env.DB.prepare(
    `SELECT t.video_id, t.title, t.created_at, t.local_date
     FROM transcripts t
     WHERE LOWER(COALESCE(t.meeting_series, '')) = ?1
       AND t.raw_text IS NOT NULL
       AND json_array_length(t.action_items) = 0
     ${unextractedFilters}
     ORDER BY COALESCE(t.local_date, substr(t.created_at, 1, 10)) ASC, t.created_at ASC, t.id ASC
     LIMIT 25`,
  )
    .bind(...unextractedBindings)
    .all<UnextractedRow>();

  const personText = input.person?.trim() ? ` for "${input.person.trim()}"` : "";

  if ((!results || results.length === 0) && (!unextracted || unextracted.length === 0)) {
    return {
      content: [{ type: "text", text: `No extracted commitments found${personText} in ${series} meetings.` }],
    };
  }

  const sections: string[] = [];
  if (results && results.length > 0) {
    const lines = results.map((row) => {
      const date = row.local_date ?? row.created_at.slice(0, 10);
      const owner = row.owner ? ` *(owner: ${row.owner})*` : "";
      const due = row.due_date ? ` — due ${row.due_date}` : "";
      return `• [${date}] **${row.title}** — ${row.task}${owner}${due} (\`${row.video_id}\`)`;
    });
    sections.push(
      `Found ${results.length} commitment${results.length === 1 ? "" : "s"}${personText} in ${series} meetings:\n\n${lines.join("\n")}`,
    );
  } else {
    sections.push(`No extracted commitments found${personText} in ${series} meetings.`);
  }

  if (unextracted && unextracted.length > 0) {
    const lines = unextracted.map((row) => {
      const date = row.local_date ?? row.created_at.slice(0, 10);
      return `• [${date}] ${row.title} (\`${row.video_id}\`)`;
    });
    sections.push(
      `${unextracted.length} matched meeting${unextracted.length === 1 ? " has" : "s have"} a raw transcript but no extracted action items yet:\n\n${lines.join("\n")}`,
    );
  }

  return { content: [{ type: "text", text: sections.join("\n\n") }] };
}
