CREATE TABLE `media_sessions` (
	`room` text NOT NULL,
	`user` text NOT NULL,
	`session` text NOT NULL,
	`seen` integer NOT NULL,
	`sharing` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`room`, `user`)
);
--> statement-breakpoint
CREATE TABLE `project_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_versions_project` ON `project_versions` (`project`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `clientId` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_dedup` ON `events` (`room`,`sender`,`clientId`);--> statement-breakpoint
ALTER TABLE `projects` ADD `revision` integer DEFAULT 0 NOT NULL;