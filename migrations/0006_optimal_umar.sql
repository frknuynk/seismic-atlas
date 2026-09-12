CREATE TABLE `source_request_control` (
	`source` text PRIMARY KEY NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`circuit_open_until` integer,
	`last_error_code` text,
	`updated_at` integer NOT NULL
);
