CREATE TABLE `note_inbox` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL DEFAULT 'mcp',
  `title` text,
  `dump` text NOT NULL,
  `intake_plan` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `error` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `synced_at` text,
  `sync_device` text,
  `obsidian_paths` text NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE INDEX `note_inbox_status_created_at_idx`
ON `note_inbox` (`status`, `created_at`);
