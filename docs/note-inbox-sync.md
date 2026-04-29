# Note Inbox Sync

Deborah can now act as a cloud inbox for thoughts that should land in a local
Obsidian vault.

## Workflow

1. An MCP client calls `capture_thought`.
2. Deborah stores the structured intake plan in D1 as `pending`.
3. A local command pulls pending notes.
4. The local command writes Markdown into the Obsidian vault.
5. Only after local writes succeed, the command marks the item `synced`.

This keeps Obsidian local while still letting Codex, ChatGPT, and future inputs
like Slack use the same capture surface.

## MCP Tool

`capture_thought` accepts:

- `dump` — raw text to preserve.
- `title` — optional short title.
- `summary` — optional organized summary.
- `tags`, `projects`, `people`, `tasks`, `decisions` — optional structured
  Obsidian intake fields.

The tool does not write local files directly. It queues work for the local sync
agent.

## Local Sync

```bash
export DEBORAH_WORKER_URL="https://aftercall.pierce-9df.workers.dev"
npm run notes:sync
```

The command auto-detects the open Obsidian vault on macOS. You can also pass it
explicitly:

```bash
npm run notes:sync -- --vault "/Users/pierce/Documents/Pierce's workspace"
```

It uses the same local bearer as vault backup:

- `VAULT_SYNC_TOKEN`
- `VAULT_SYNC_SECRET`
- `~/.deborah/vault-sync-token`

## API Endpoints

These endpoints are for the local sync agent and require the local bearer:

- `POST /notes/capture`
- `GET /notes/pending?limit=25`
- `POST /notes/:id/synced`

## Why Hybrid

Cloudflare is the queue and context layer. The local script is the filesystem
writer. That means captured notes work from Codex or ChatGPT, but nothing in the
cloud needs direct access to the Mac's local vault.
