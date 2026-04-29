# Note Inbox Sync

## Intent

Let Pierce dump thoughts from Codex, ChatGPT, or future inputs like Slack, then
land those thoughts in the local Obsidian vault with minimal manual handling.

## V1 Scope

- Add a D1-backed note inbox.
- Add an MCP tool, `capture_thought`, that queues structured Obsidian intake
  plans.
- Add local bearer-protected endpoints for a sync agent:
  - `GET /notes/pending`
  - `POST /notes/:id/synced`
  - `POST /notes/capture`
- Add `npm run notes:sync` to write pending items into the local vault and ack
  them only after successful local writes.

## Non-Goals

- No local daemon yet.
- No automatic OpenAI organization inside the Worker yet; the MCP caller can
  pass structured fields.
- No Slack ingestion yet.
- No direct cloud write access to the local vault.

## Decision

Use Cloudflare as the durable queue and context layer, and keep Obsidian file
writes local. This keeps the workflow accessible from remote MCP clients while
preserving the local-vault safety boundary.
