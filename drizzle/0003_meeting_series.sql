ALTER TABLE `transcripts` ADD COLUMN `meeting_series` text;
--> statement-breakpoint
ALTER TABLE `transcripts` ADD COLUMN `local_date` text;
--> statement-breakpoint
CREATE INDEX `transcripts_meeting_series_local_date_idx` ON `transcripts` (`meeting_series`, `local_date`);
--> statement-breakpoint
UPDATE `transcripts`
SET `meeting_series` = 'HTS', `local_date` = '2026-04-21'
WHERE `video_id` = 'backfill:leadership-team-daily-sync';
--> statement-breakpoint
UPDATE `transcripts`
SET `meeting_series` = 'HTS', `local_date` = '2026-04-22'
WHERE `video_id` = 'meet.google.com/vbe-gsfi-tzi';
--> statement-breakpoint
UPDATE `transcripts`
SET `meeting_series` = 'HTS', `local_date` = '2026-04-27'
WHERE `video_id` = 'meet.google.com/qpm-zeku-jai';
