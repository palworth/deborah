CREATE TABLE `vault_sync_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `vault_name` text NOT NULL,
  `device_id` text,
  `started_at` text DEFAULT (datetime('now')) NOT NULL,
  `completed_at` text,
  `files_uploaded` integer DEFAULT 0 NOT NULL,
  `files_skipped` integer DEFAULT 0 NOT NULL,
  `files_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_files` (
  `vault_name` text NOT NULL,
  `path` text NOT NULL,
  `r2_key` text NOT NULL,
  `sha256` text,
  `size` integer NOT NULL,
  `mtime_ms` integer NOT NULL,
  `content_type` text,
  `deleted_at` text,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY (`vault_name`, `path`)
);
--> statement-breakpoint
CREATE INDEX `vault_files_vault_updated_idx` ON `vault_files` (`vault_name`, `updated_at`);
