import type { IntakePlan } from "../obsidian/intake";

interface PendingNote {
  id: string;
  intakePlan: IntakePlan;
}

interface PendingResponse {
  notes?: PendingNote[];
}

export interface WritePlanResult {
  paths: string[];
}

export interface SyncNoteInboxOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  writePlan: (plan: IntakePlan, options: { now?: Date }) => Promise<WritePlanResult>;
  limit?: number;
  now?: Date;
  device?: string;
}

export interface SyncNoteInboxResult {
  synced: number;
  notes: Array<{ id: string; paths: string[] }>;
}

export async function syncNoteInboxToObsidian(
  options: SyncNoteInboxOptions,
): Promise<SyncNoteInboxResult> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const limit = options.limit ?? 25;
  const pendingRes = await fetchImpl(`${baseUrl}/notes/pending?limit=${limit}`, {
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (!pendingRes.ok) {
    throw new Error(`Failed to list pending notes: ${pendingRes.status} ${await pendingRes.text()}`);
  }

  const pending = (await pendingRes.json()) as PendingResponse;
  const notes = pending.notes ?? [];
  const synced: SyncNoteInboxResult["notes"] = [];

  for (const note of notes) {
    const write = await options.writePlan(note.intakePlan, { now: options.now });
    const ackRes = await fetchImpl(`${baseUrl}/notes/${encodeURIComponent(note.id)}/synced`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device: options.device,
        paths: write.paths,
      }),
    });
    if (!ackRes.ok) {
      throw new Error(`Failed to mark note ${note.id} synced: ${ackRes.status} ${await ackRes.text()}`);
    }
    synced.push({ id: note.id, paths: write.paths });
  }

  return { synced: synced.length, notes: synced };
}
