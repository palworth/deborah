# Obsidian Notes Intake

This is the local-first bridge between messy Codex dumps and an Obsidian vault.
It does not touch the deployed Worker, D1, Vectorize, Notion, or aftercall's
meeting ingestion path.

## Quick Start

The script auto-detects the currently open Obsidian vault on macOS. You can also
set your vault path explicitly:

```bash
export OBSIDIAN_VAULT="$HOME/path/to/your/Obsidian Vault"
```

Bootstrap the lightweight dashboards:

```bash
npm run notes:intake -- --bootstrap
```

Capture a raw dump:

```bash
pbpaste | npm run notes:intake -- --title "Monday planning dump"
```

The script writes to:

- `Inbox/Dumps/` for preserved raw dumps
- `Inbox/YYYY-MM-DD.md` for daily captures
- `Next Actions.md` for extracted action items
- `Projects/` for project notes
- `People/` for person notes
- `Decisions/` for durable decisions
- `Dashboards/` for Obsidian Bases views

## Codex Intake Plan

For best results, have Codex turn a messy dump into this JSON shape and pass it
with `--plan`:

```json
{
  "title": "Monday planning dump",
  "dump": "The original raw text goes here.",
  "summary": "Short summary of what changed.",
  "tags": ["planning"],
  "projects": [
    {
      "name": "Project Atlas",
      "status": "active",
      "summary": "The project needs a cleaner next-action list.",
      "notes": ["Budget and review timing are still fuzzy."],
      "nextActions": ["Draft the first project review outline"]
    }
  ],
  "people": [
    {
      "name": "Sarah",
      "notes": ["Waiting for review timing."],
      "nextActions": ["Ask Sarah for review timing"]
    }
  ],
  "tasks": [
    {
      "text": "Follow up with Sarah about review timing",
      "project": "Project Atlas",
      "person": "Sarah",
      "due": "2026-04-30",
      "priority": "high"
    }
  ],
  "decisions": [
    {
      "title": "Use Obsidian as the notes source of truth",
      "project": "Project Atlas",
      "decision": "Keep organized notes in Obsidian and index them later.",
      "rationale": "This gives value before adding a full sync/indexing layer."
    }
  ]
}
```

Run it:

```bash
npm run notes:intake -- --plan /tmp/intake-plan.json
```

Preview without writing:

```bash
npm run notes:intake -- --plan /tmp/intake-plan.json --dry-run
```

## Safety Rules

- Raw dumps are always preserved.
- Existing project, person, daily, and task files are appended to, not rewritten.
- Existing decision and raw dump files are skipped on path collision.
- Generated paths are constrained to the configured vault directory.
- The script works with plain Markdown and Obsidian Bases; no Obsidian plugin is
  required.
