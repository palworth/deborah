# Implementation Plan

Four phases (Phase 1 split into 1a + 1b per plan-reviewer feedback). TDD-strict per `conductor/workflow.md`. Commit cadence = red → green → refactor within a phase; phase boundary = PR-level checkpoint. Single PR at end of track against `main`.

Branch: `feat/notion-redesign-and-rag-tool`

---

## Phase 1a: Notion schema + code changes (no production data touch)

**Goal:** make the code produce slim Transcripts pages + Followups with `Meeting` relation. Pure code change — existing production data untouched.

### Tasks

1. **[test]** Add failing tests to `src/notion.test.ts`, named for traceability in acceptance criteria:
   - `builds transcripts page with <= 2 children blocks (bluedot link only)`
   - `buildTranscriptPageBody omits summary and action_items rich_text properties`
   - `buildTranscriptPageBody includes Recording URL when meetingUrl is set`
   - `buildTranscriptPageBody includes Bluedot Page URL when provided`
   - `buildFollowupRowBody requires transcriptPageId and returns Meeting relation`
   - `createFollowupRow threads Meeting relation through to pagesCreate`

2. **[green]** Update `src/notion.ts`:
   - Delete `summaryToBlocks`, `heading3`. `richTextSegments` can stay (defensive; or delete if truly unused).
   - Shrink `buildTranscriptPageBody.children` to `[ paragraph("View on Bluedot: <url>") ]` when `meetingUrl` set, else `[]`.
   - Remove `Summary`, `Action Items` rich_text properties.
   - Add `Recording URL` (url) and `Bluedot Page` (url) properties — both optional.
   - `FollowupInput` gains `transcriptPageId: string` (required).
   - Add `Meeting` property: `{ type: "relation", relation: [{ id: transcriptPageId }] }`.
   - Drop `Meeting Title` rich_text (the relation now serves this purpose — confirm in Notion UI after smoke).

3. **[wire]** **(Promoted — the hard bit.)** Update `src/handler.ts` `handleSummaryEvent`:
   - After `createTranscriptPage` returns `{ pageId }`, save it to `transcriptPageId`.
   - Pass `transcriptPageId` to every `createFollowupRow` call in the loop.
   - Write `notion_page_id = transcriptPageId` to D1 via existing `markNotionSynced` flow (already does this — verify).
   - Add a test: `handler.test.ts` — `createFollowupRow is called with transcriptPageId from createTranscriptPage result`.

4. **[typecheck + tests]** `npx vitest run` + `npx tsc --noEmit`. All green.

5. **[commit]** Multiple commits per TDD cycle. Push branch.

### Files touched

- `src/notion.ts`, `src/notion.test.ts`
- `src/handler.ts`, `src/handler.test.ts`

### Checkpoint

- Unit tests green, typecheck clean
- **Do not deploy yet** — Phase 1b prepares production data first

---

## Phase 1b: Production data migration

**Goal:** bring the production Notion workspace in sync with the new schema before the new code ships.

### Tasks

1. **[pre-flight]** Write and run the pre-flight checks from `migration.md`:
   - Confirm D1 `summary` column stores full `summaryV2` markdown (rollback safety)
   - Confirm sample Followups row has `Video ID` property (backfill join key)
   - Confirm Notion integration has write access to both DBs
   - Halt if any check fails; rescope the track before proceeding

2. **[schema]** In Notion UI:
   - On Transcripts DB: add `Recording URL` (url), `Bluedot Page` (url) properties
   - On Followups DB: add `Meeting` relation property targeting Transcripts DB
   - **Do not delete** old `Summary` / `Action Items` rich_text properties yet — they'll be ignored by new code but preserve historical data

3. **[backfill script]** Create `scripts/backfill-meeting-relation.ts`:
   - `--dry-run` flag (default true) — prints what would change
   - `--checkpoint-file` (default `/tmp/aftercall-backfill-checkpoint.json`) — resumability
   - Iterates Followups DB, reads `Video ID`, looks up Transcripts row by `Video ID`, updates `Meeting` relation
   - Sleeps 400ms between Notion writes (stays under 3 req/s limit)
   - Retries on 429 with exponential backoff (3 attempts)
   - Skips rows already having `Meeting` populated (idempotent)
   - Logs each transition (`followup_id → meeting_page_id`)

4. **[dry-run]** Run with `--dry-run`. Verify the planned writes look correct.

5. **[execute]** Run without `--dry-run`. Watch the log. Verify checkpoint file is written.

6. **[audit]** Open 3 random Followups in Notion, click `Meeting` → confirm it navigates to the expected Transcripts page.

7. **[checkpoint]** All existing Followups now have `Meeting` relation populated. No code deployed yet.

### Files touched

- `scripts/backfill-meeting-relation.ts` (new)
- `conductor/tracks/notion-redesign-and-rag-tool/migration.md` (new — detailed pre-flight + backfill + rollback procedures)

### Checkpoint

- Backfill complete; all historical Followups have `Meeting` relation
- Safe to deploy Phase 1a code now — new code writes new relations on new rows, backfilled rows already have them

---

## Phase 2: `answer_from_transcript` MCP tool

**Goal:** ship the RAG tool. Can run in parallel with Phase 1b once the metadata index is in place.

### Tasks

1. **[prerequisite]** Create Vectorize metadata index on production:
   ```
   npx wrangler vectorize create-metadata-index aftercall-vectors \
     --property-name=transcript_id --type=number
   ```
   Document the command in `scripts/setup.ts` so new forkers get it automatically (idempotent — setup already skips existing resources).

2. **[prerequisite]** Reinsert existing vectors so the metadata index covers them. Options:
   - **Option A (simplest, cheap):** Script that reads every `transcripts` row from D1, re-runs `generateEmbeddings` on `raw_text`, re-upserts via `upsertChunkEmbeddings`. Costs ~$0.0001 per call × N calls. Idempotent (deterministic IDs). Put in `scripts/reindex-vectorize.ts`.
   - **Option B (skip historical):** Only index new ingestions. Document the caveat.
   - **Decision:** Option A. Low cost, cleaner semantics.

3. **[test]** Create `src/mcp/tools/answer_from_transcript.test.ts` with named tests:
   - `resolves video_id to transcript_id via D1 lookup`
   - `returns helpful error for unknown video_id`
   - `filters vectorize by transcript_id metadata`
   - `falls back to d1 raw_text when vectorize returns no chunks`  ← eventual consistency safety
   - `passes top-K chunks as context to openai`
   - `retries on transient OpenAI errors (5xx/429)`
   - `returns { content: [{ type: "text", text: <answer> }] }`

4. **[green]** Create `src/mcp/tools/answer_from_transcript.ts`:
   - Signature: `(args: { video_id: string; question: string }, env: Env, deps?: { openai?: OpenAI })` → `ToolResult`
   - D1 lookup: `SELECT id, raw_text FROM transcripts WHERE video_id = ?1`
   - If no row: return `"Call not found: <video_id>"` error message
   - Embed the question with `text-embedding-3-small`
   - Query Vectorize: `index.query(vector, { topK: 8, filter: { transcript_id } })`
   - If zero matches AND `raw_text` present: use `raw_text` (truncated to ~24k chars) as the single context block (eventual-consistency fallback)
   - If zero matches AND no `raw_text`: return `"Transcript not yet indexed — try again in a moment."`
   - Build prompt: system = "Answer using only the provided transcript excerpts. If the answer isn't in the excerpts, say so."; user = excerpts + question
   - Call `gpt-5-mini` with retries (reuse `extract.ts` retry pattern — extract if worth extracting)
   - Return answer in `content[0].text`

5. **[register]** Wire into `src/mcp/tools.ts` via the existing `listTools()` + dispatch pattern.

6. **[eval set]** Create `scripts/smoke-answer.ts`:
   - 3–5 `(video_id, question, expected_keywords[])` tuples against real production calls
   - Invokes `answer_from_transcript` directly
   - Asserts `expected_keywords` appear in the answer
   - Runs manually, not in CI (needs real secrets)

7. **[docs]** Add `answer_from_transcript` section to `docs/tools.md` with input schema + example prompts:
   - _"In the IT Hiring call, when did we discuss the €1,500 offer?"_
   - _"What did Jugoslav say about MCP servers?"_
   - _"Summarize the compensation section of call X."_

8. **[setup]** Update `scripts/setup.ts` to create the metadata index on fresh forks. Make it idempotent (check-then-create).

9. **[smoke]** Manual smoke in Claude.ai: ask a question against an indexed call. Confirm the answer quotes content actually present in the transcript.

10. **[checkpoint]** Tests green, typecheck clean, smoke passes. Eval script passes.

### Files touched

- `src/mcp/tools/answer_from_transcript.ts` (new)
- `src/mcp/tools/answer_from_transcript.test.ts` (new)
- `src/mcp/tools.ts` (registration)
- `scripts/reindex-vectorize.ts` (new — one-off migration)
- `scripts/smoke-answer.ts` (new — canned eval)
- `scripts/setup.ts` (metadata index creation)
- `docs/tools.md`

### Design notes

- **Vectorize filter syntax** — confirmed via `wrangler vectorize` CLI reference. Property must be pre-declared as a metadata index (prerequisite step above).
- **Fallback on eventual consistency** — keeps the UX honest for "just-happened" calls.
- **Prompt template** baked into tests so regressions are visible.

---

## Phase 3: Docs + roadmap

**Goal:** make the external story match the internal reality.

### Tasks

1. **[README]** Update Roadmap:
   - Expand `delete_call` to mention: (a) unlink the `Meeting` relation on Followup rows first, (b) does NOT touch Bluedot's native Notion page (that's Bluedot's, not ours), (c) consider a dry-run guard since it's destructive
   - Move `answer_from_transcript` from "would be nice" to the Shipped section (or just the main tools table above)
   - Update the "What you get" section to reflect slim Transcripts pages

2. **[architecture]** Update `docs/architecture.md`:
   - Ingestion data-flow: Transcripts row = metadata hub, Followups linked via `Meeting` relation
   - Add a short section: "Why aftercall doesn't render the summary" — brief, references Bluedot's native sync
   - Verify Mermaid diagrams still render on GitHub (no `\n` inside node labels, quoted paths for `/`-prefixed labels — we already fixed this earlier)

3. **[tools.md]** Confirm `answer_from_transcript` section added in Phase 2 is thorough. Update the intro table to include it.

4. **[CHANGELOG]** Write `0.5.0` entry:
   - Breaking: Transcripts DB schema change (requires migration)
   - Added: `Meeting` relation on Followups
   - Added: `answer_from_transcript` MCP tool
   - Added: Vectorize metadata index on `transcript_id`
   - Removed: `Summary`, `Action Items` rich_text properties on Transcripts pages
   - Migration: see `conductor/tracks/notion-redesign-and-rag-tool/migration.md`

5. **[checkpoint]** GitHub preview of README + architecture.md renders correctly.

### Files touched

- `README.md`
- `docs/architecture.md`
- `docs/tools.md`
- `CHANGELOG.md`

---

## Track completion

- [ ] All phase checkpoints met (spec.md § Acceptance criteria)
- [ ] Branch pushed
- [ ] PR against `main` opened with spec.md as PR description (or linked)
- [ ] Self-reviewed cohesively
- [ ] Squash-merge
- [ ] `conductor/tracks.md`: move entry from Active → Completed
- [ ] Production redeploy via `npm run deploy`
- [ ] Post-deploy smoke: fire a real webhook, verify slim Transcripts + Followups with relation + MCP tool works
