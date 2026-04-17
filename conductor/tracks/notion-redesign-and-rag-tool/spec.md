# Track: notion-redesign-and-rag-tool

**Status:** active
**Branch:** `feat/notion-redesign-and-rag-tool`
**Created:** 2026-04-16

## Why this track exists

Two problems surfaced from production use:

1. **Duplicated summary content in Notion.** Bluedot's native Notion sync already creates a rich summary page per meeting (Overview + grouped Action Items + Topics). aftercall's "Call Transcripts" DB was a lower-quality duplicate that rendered `summaryV2` as a single paragraph block. We partially fixed the 400 with a markdown-to-blocks parser, but parsing is solving the wrong problem — we shouldn't be rendering the summary at all. Each Notion surface needs a single owner.

2. **No "ask the transcript a question" capability.** MCP already exposes `search_calls` (semantic search across all calls) and `get_call` (full details). What's missing is RAG over a *single* call: _"when in this call did we discuss the €1,500 offer?"_ — needs to filter Vectorize by `video_id` and feed chunks + question into the model.

This track also extends the `delete_call` roadmap entry to account for the new `Meeting` relation on Followups.

## What success looks like

- Transcripts DB acts as a structured **metadata hub** per meeting (Date, Participants, Video ID, Recording URL, Bluedot Page URL, Followups relation) with an empty-ish body — just a link to Bluedot's native summary page and a linked view of related followups.
- Every Followup row has a real `Meeting` **relation** (not a text field) pointing back to its Transcripts row.
- MCP exposes a 6th tool: `answer_from_transcript(video_id, question)` returning a model-generated answer grounded in Vectorize-retrieved chunks from that specific call.
- README Roadmap's `delete_call` entry is updated to mention unlinking the `Meeting` relation as part of the destructive operation.
- No duplicated summary content in aftercall's Notion. `summaryToBlocks` and related markdown-parsing code is deleted.

## Scope — in

- Notion DB schema changes (slim Transcripts, add `Meeting` relation on Followups)
- Code changes in `src/notion.ts`, `src/handler.ts`, `src/mcp/tools/`
- New MCP tool `answer_from_transcript` with tests
- Setup script updates (`scripts/setup.ts`) so new forkers get the new schema
- Roadmap + architecture docs updates
- Migration path for existing Transcripts/Followups rows in the production DB (one-off script or manual SQL)

## Scope — out

- Implementing `delete_call` itself (stays on roadmap)
- Multi-tenant or auth-level features
- Changing D1 schema (it already holds everything we need)
- Changing Vectorize schema beyond using existing metadata filters

## Non-goals

- Parity with Bluedot's native page — we're explicitly deferring to Bluedot for summary content
- Backfilling summary content into Transcripts rows for historical meetings (they'll just have a link)

## Key design decisions

1. **Bluedot owns the summary page.** aftercall owns the structured/queryable layer.
2. **`Meeting` is a Notion relation, not a text property.** Clickable two-way link enables "all followups for this meeting" views.
3. **`answer_from_transcript` is single-call RAG, not multi-call.** `search_calls` already covers cross-call search. This tool is for "drill into one meeting."
4. **Vectorize metadata must include `video_id` / `transcript_id`** (already does) so we can filter by call. If filters don't work on our Vectorize config, we fall back to querying all, then post-filter.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| **Vectorize metadata index is not declared** — Cloudflare Vectorize only filters on pre-declared indexed metadata fields. Without it, `filter: { transcript_id }` returns unfiltered results silently. | **Prerequisite to Phase 2.** Create the metadata index via `wrangler vectorize create-metadata-index aftercall-vectors --property-name=transcript_id --type=number`. Document in `setup.ts` so new forkers get it automatically. Existing production vectors will need to be reinserted (metadata indexes only apply to vectors inserted **after** index creation) — reinsertion procedure lives in `migration.md`. |
| Vectorize eventual consistency — a query seconds after ingest may not see new vectors | `answer_from_transcript` falls back to D1 `raw_text` (loaded and used as a single context block, truncated) when Vectorize returns zero matching chunks. Prevents "the system seems broken" immediately post-ingest. |
| Notion "delete property" is actually "archive" — orphan values stay on rows, invisible | Documented in `migration.md`. New writes populate new properties; old rich_text values are harmless ghosts. No automatic cleanup — user can manually delete properties from the DB UI if they want. |
| Notion API rate limit (3 req/s) during Followups `Meeting` relation backfill | Backfill script sleeps 400ms between requests (max ~2.5 req/s), retries on 429 with exponential backoff, writes checkpoints after each row update to a local JSON file for resume, supports `--dry-run` flag. |
| `Video ID` property may not exist on existing Followups rows — backfill join key missing | **Pre-flight check** in migration.md: query an existing Followup row and confirm `Video ID` is present. If not, backfill is impossible and the track needs rescoping before starting. |
| Rollback regret — if we decide we want summary content back in aftercall's Notion, it's gone | Pre-flight check: confirm D1 `summary` column stores the full `summaryV2` markdown (not the extracted structured form). If it does, rollback is always possible by re-running `createTranscriptPage` with the old code path. Verified in migration.md before Phase 1 starts. |
| Can't programmatically find Bluedot's native page URL to populate `Bluedot Page` | Best-effort: search Notion under `BlueDot Calls` parent by title + created date. Notion search is ranked, not exact, and eventually consistent — do NOT put it on the critical ingestion path. If it fails, property stays empty; optionally a background retry job can populate later. |
| `answer_from_transcript` quality depends on chunk retrieval | Start with topK=8. Add a canned eval set in `scripts/smoke-answer.ts` with 3–5 Q&A pairs against real calls, expected answer keywords asserted. Tune K or prompt if evals fail. |
| Dead code regret — we just wrote `summaryToBlocks` | Fine. It fixed a real production 400 bug. This track obviates it; it's not retroactively invalidated. |

## Acceptance criteria

### Phase 1a (schema + code, no production data touch)

- [ ] `buildTranscriptPageBody` returns ≤ 2 children blocks (Bluedot link paragraph + optional linked-view embed)
- [ ] `buildTranscriptPageBody` no longer returns `Summary` or `Action Items` rich_text properties
- [ ] `buildTranscriptPageBody` returns `Recording URL`, `Bluedot Page` URL properties
- [ ] `buildFollowupRowBody` accepts `transcriptPageId` and returns a `Meeting` relation property
- [ ] `handleSummaryEvent` in `handler.ts` captures Transcripts page ID and threads it to every `createFollowupRow` call
- [ ] All existing tests still pass; new tests cover the above behaviors by name (see `implementation.md`)
- [ ] `npx tsc --noEmit` clean

### Phase 1b (production data migration)

- [ ] `migration.md` pre-flight checks all pass: D1 `summary` column contains full `summaryV2`, sample Followups row has `Video ID`
- [ ] Notion Transcripts DB schema updated (new URL properties added; old rich_text properties archived via UI)
- [ ] Notion Followups DB has `Meeting` relation property targeting Transcripts DB
- [ ] `scripts/backfill-meeting-relation.ts` run in `--dry-run` mode first, output reviewed
- [ ] Full backfill run; all existing Followups rows have `Meeting` relation populated
- [ ] Post-backfill audit: open 3 random Followups, confirm Meeting click-through works

### Phase 2 (answer_from_transcript)

- [ ] Vectorize metadata index on `transcript_id` created on production binding
- [ ] Old chunks reinserted per `migration.md`
- [ ] `src/mcp/tools/answer_from_transcript.ts` + tests — specifically: test names `resolves video_id to transcript_id`, `filters vectorize by transcript_id`, `falls back to d1 raw_text when no chunks`, `returns helpful error for unknown video_id`, `retries on transient OpenAI errors`
- [ ] Tool registered in `src/mcp/tools.ts` and discoverable via `tools/list`
- [ ] `scripts/smoke-answer.ts` passes against a real production call with 3+ Q&A pairs (keyword assertions on the answer)
- [ ] Manual smoke in Claude.ai: ask a specific question about a known call, answer cites the right context
- [ ] Setup script creates the Vectorize metadata index on fresh forks

### Phase 3 (docs)

- [ ] README Roadmap `delete_call` entry mentions: (a) unlink `Meeting` relation on Followups, (b) does NOT delete Bluedot's native Notion page
- [ ] `docs/architecture.md` ingestion data-flow diagram updated; Mermaid still parses on GitHub
- [ ] `docs/tools.md` has `answer_from_transcript` section with example prompts
- [ ] `CHANGELOG.md` entry for `0.5.0` — schema change + new MCP tool

### Track completion

- [ ] `npx vitest run` green; no test count regression (current baseline: 115)
- [ ] `npx tsc --noEmit` clean
- [ ] End-to-end: fire a real Bluedot webhook, `wrangler tail` confirms Transcripts page is slim + Followups have Meeting relation
- [ ] MCP smoke: Claude.ai can call `answer_from_transcript` and get a grounded answer
- [ ] PR against `main` opened, self-reviewed top-to-bottom, squash-merged
- [ ] `conductor/tracks.md` updated — track moves from Active → Completed
- [ ] Production redeployed via `npm run deploy`

### Commit granularity

Phase boundary = PR-level checkpoint (verification + merge-readiness). Within a phase, commits follow red → green → refactor cadence (one commit per TDD cycle is ideal; one per phase is wrong). Phases are shipped via a single PR at the end of the track, not per-phase PRs.
