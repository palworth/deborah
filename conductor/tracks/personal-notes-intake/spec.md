# Personal Notes Intake

## Status

Active

## Problem

aftercall captures meeting context, but loose thoughts, priorities, project notes,
and follow-up ideas still live outside the system. The user wants to dump raw
notes into a Codex agent and have those notes land in a local Obsidian vault in a
useful shape without learning an elaborate Obsidian workflow first.

## Goals

- Preserve every raw dump so nothing is lost.
- Let Codex do the interpretation work and let a script do deterministic vault
  writes.
- Create Obsidian-native Markdown with properties, wikilinks, tasks, project
  notes, people notes, decision notes, and lightweight dashboards.
- Keep the first version local-only and independent of Cloudflare, Notion, and
  aftercall's production ingestion path.

## Non-goals

- Build an Obsidian plugin.
- Sync the entire vault into D1 or Vectorize.
- Rewrite or reorganize existing vault content automatically.
- Merge aftercall meeting transcripts into Obsidian in this phase.

## Design

The flow is intentionally small:

1. User dumps notes into Codex.
2. Codex converts the dump into an `IntakePlan` JSON object.
3. `scripts/obsidian-intake.ts` writes the plan into a local vault.
4. Obsidian displays the resulting Markdown and Base dashboards.

The script writes:

- `Inbox/Dumps/<date time - title>.md` for the raw dump.
- `Inbox/<date>.md` as the daily capture stream.
- `Next Actions.md` for extracted tasks.
- `Projects/<name>.md` for project updates.
- `People/<name>.md` for person context.
- `Decisions/<date - title>.md` for durable decisions.
- `Dashboards/*.base` for lightweight project/action views.

## Phases

### Phase 1: Local Writer

- Add typed intake document builders.
- Add tests for raw dump preservation, task formatting, wikilinks, project
  updates, people updates, decision notes, and dashboard templates.
- Add a CLI that writes the generated documents to a vault path supplied by
  `--vault` or `OBSIDIAN_VAULT`.

### Phase 2: Codex Skill

- Install a local Codex skill that turns messy user input into the `IntakePlan`
  shape and runs the writer.
- Keep the skill conservative: preserve raw text, append to existing notes, and
  never delete vault content.

### Phase 3: aftercall Bridge

- Later, add an explicit bridge from indexed meetings to Obsidian project/person
  notes. This should reuse the same writer contract so meetings and note dumps
  converge on one vault shape.

## Decisions

- Use Obsidian as the human-readable source of truth for notes.
- Keep aftercall's deployed Worker untouched in the first phase.
- Avoid direct Obsidian plugin work until the local writer proves useful.
- Store generated tasks as plain Markdown tasks so Obsidian can render and query
  them without a dependency on a task plugin.
