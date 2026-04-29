import type { Env } from "../env";
import type {
  IntakeDecision,
  IntakePerson,
  IntakePlan,
  IntakeProject,
  IntakeTask,
} from "../obsidian/intake";
import type { ToolResult } from "../mcp/tools/recent_calls";

export interface CaptureThoughtInput {
  title?: string;
  dump: string;
  summary?: string;
  tags?: string[];
  projects?: IntakeProject[];
  people?: IntakePerson[];
  tasks?: IntakeTask[];
  decisions?: IntakeDecision[];
}

interface CaptureDeps {
  id?: () => string;
  now?: () => string;
}

interface PendingNoteRow {
  id: string;
  source: string;
  title: string | null;
  status: string;
  created_at: string;
  intake_plan: string;
}

const MAX_DUMP_CHARS = 25_000;
const MAX_PENDING_LIMIT = 50;

export async function captureThought(
  input: CaptureThoughtInput,
  env: Env,
  deps: CaptureDeps = {},
): Promise<ToolResult> {
  const plan = normalizeCaptureInput(input);
  const id = deps.id?.() ?? crypto.randomUUID();
  const createdAt = deps.now?.() ?? sqliteNow();

  await env.DB
    .prepare(
      `INSERT INTO note_inbox
         (id, source, title, dump, intake_plan, status, created_at, obsidian_paths)
       VALUES (?1, 'mcp', ?2, ?3, ?4, 'pending', ?5, '[]')`,
    )
    .bind(id, plan.title ?? null, plan.dump, JSON.stringify(plan), createdAt)
    .run();

  return {
    content: [
      {
        type: "text",
        text: `Captured thought ${id}. It is queued for local Obsidian sync.`,
      },
    ],
  };
}

export async function handleCaptureThought(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireLocalBearer(request, env);
  if (unauthorized) return unauthorized;

  let input: CaptureThoughtInput;
  try {
    input = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const result = await captureThought(input, env);
    return Response.json({
      ok: true,
      message: result.content[0].text,
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 400 });
  }
}

export async function handleListPendingNotes(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireLocalBearer(request, env);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get("limit") ?? 25));
  const { results } = await env.DB
    .prepare(
      `SELECT id, source, title, status, created_at, intake_plan
       FROM note_inbox
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<PendingNoteRow>();

  return Response.json({
    notes: (results ?? []).map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      intakePlan: JSON.parse(row.intake_plan) as IntakePlan,
    })),
  });
}

export async function handleMarkNoteSynced(
  request: Request,
  env: Env,
  deps: Pick<CaptureDeps, "now"> = {},
): Promise<Response> {
  const unauthorized = requireLocalBearer(request, env);
  if (unauthorized) return unauthorized;

  const id = noteIdFromSyncedUrl(request.url);
  if (!id) return new Response("Missing note id", { status: 400 });

  let body: { device?: string; paths?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const paths = Array.isArray(body.paths) ? body.paths.filter((path) => typeof path === "string") : [];
  const syncedAt = deps.now?.() ?? sqliteNow();
  await env.DB
    .prepare(
      `UPDATE note_inbox
       SET status = 'synced',
           synced_at = ?1,
           sync_device = ?2,
           obsidian_paths = ?3
       WHERE id = ?4 AND status = 'pending'`,
    )
    .bind(syncedAt, body.device ?? null, JSON.stringify(paths), id)
    .run();

  return Response.json({ ok: true, id });
}

function normalizeCaptureInput(input: CaptureThoughtInput): IntakePlan {
  const dump = input.dump?.trim();
  if (!dump) throw new Error("dump is required");
  if (dump.length > MAX_DUMP_CHARS) {
    throw new Error(`dump is too long; max ${MAX_DUMP_CHARS} characters`);
  }

  return {
    title: cleanOptional(input.title),
    dump,
    summary: cleanOptional(input.summary),
    tags: input.tags?.filter((tag) => typeof tag === "string" && tag.trim()),
    projects: input.projects,
    people: input.people,
    tasks: input.tasks,
    decisions: input.decisions,
  };
}

function requireLocalBearer(request: Request, env: Env): Response | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!env.VAULT_SYNC_SECRET || !token || token !== env.VAULT_SYNC_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

function noteIdFromSyncedUrl(url: string): string | null {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/^\/notes\/([^/]+)\/synced$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.max(1, Math.min(Math.trunc(value), MAX_PENDING_LIMIT));
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function sqliteNow(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}
