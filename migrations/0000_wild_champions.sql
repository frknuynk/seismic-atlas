CREATE TABLE `ingestion_state` (
	`source` text PRIMARY KEY NOT NULL,
	`last_success_window_end` integer,
	`last_full_reconcile_at` integer,
	`adapter_version` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_event_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_event_pk` text NOT NULL,
	`revision_no` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`observed_at` integer NOT NULL,
	`source_updated_at` integer,
	`origin_time` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`depth_km` real,
	`magnitude` real,
	`magnitude_type` text,
	`place_raw` text,
	`raw_json` text,
	FOREIGN KEY (`source_event_pk`) REFERENCES `source_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_revisions_event_payload` ON `source_event_revisions` (`source_event_pk`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `idx_revisions_event_observed` ON `source_event_revisions` (`source_event_pk`,`observed_at`);--> statement-breakpoint
CREATE TABLE `source_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_event_id` text NOT NULL,
	`origin_time` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`depth_km` real,
	`magnitude` real,
	`magnitude_type` text,
	`place_raw` text,
	`event_type` text,
	`source_status` text,
	`h3_r4` text,
	`h3_r5` text,
	`h3_r6` text,
	`h3_r7` text,
	`province_code` text,
	`source_updated_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`payload_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_source_event` ON `source_events` (`source`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `idx_events_time` ON `source_events` (`origin_time`);--> statement-breakpoint
CREATE INDEX `idx_events_source_time` ON `source_events` (`source`,`origin_time`);--> statement-breakpoint
CREATE INDEX `idx_events_mag_time` ON `source_events` (`magnitude`,`origin_time`);--> statement-breakpoint
CREATE INDEX `idx_events_h3_r5` ON `source_events` (`h3_r5`);--> statement-breakpoint
CREATE INDEX `idx_events_h3_r6` ON `source_events` (`h3_r6`);--> statement-breakpoint
CREATE TABLE `source_health` (
	`source` text PRIMARY KEY NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`latest_event_time` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL
);
