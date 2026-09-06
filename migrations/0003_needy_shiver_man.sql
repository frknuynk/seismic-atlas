CREATE TABLE `ingestion_rejections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`source_event_id` text,
	`reason` text NOT NULL,
	`observed_at` integer NOT NULL,
	`raw_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_rejections_run` ON `ingestion_rejections` (`run_id`);