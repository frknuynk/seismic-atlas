CREATE TABLE `ingestion_leases` (
	`source` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`duplicates_dropped` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`unchanged` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_runs_source_started` ON `ingestion_runs` (`source`,`started_at`);