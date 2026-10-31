CREATE TABLE `canonical_events` (
	`id` text PRIMARY KEY NOT NULL,
	`preferred_source_event_pk` text,
	`association_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`preferred_source_event_pk`) REFERENCES `source_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `canonical_event_members` (
	`canonical_event_id` text NOT NULL,
	`source_event_pk` text NOT NULL,
	`association_score` real,
	`association_method` text NOT NULL,
	`associated_at` integer NOT NULL,
	FOREIGN KEY (`canonical_event_id`) REFERENCES `canonical_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_event_pk`) REFERENCES `source_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_canonical_member` ON `canonical_event_members` (`canonical_event_id`,`source_event_pk`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_event_canonical` ON `canonical_event_members` (`source_event_pk`);
--> statement-breakpoint
CREATE INDEX `idx_canonical_members_event` ON `canonical_event_members` (`canonical_event_id`);
