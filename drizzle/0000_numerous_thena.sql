CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`track` text NOT NULL,
	`user` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_comments_track` ON `comments` (`track`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_room_id` ON `events` (`room`,`id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`purpose` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_files_owner` ON `files` (`owner`);--> statement-breakpoint
CREATE TABLE `follows` (
	`user` text NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`user`, `target`)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`room` text NOT NULL,
	`user` text NOT NULL,
	`seen` integer NOT NULL,
	PRIMARY KEY(`room`, `user`)
);
--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `members` (`user`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`roles` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`avatar` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_username_unique` ON `profiles` (`username`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`project` text NOT NULL,
	`file` text NOT NULL,
	PRIMARY KEY(`project`, `file`)
);
--> statement-breakpoint
CREATE INDEX `idx_project_files_file` ON `project_files` (`file`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner` ON `projects` (`owner`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`track` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`project` text,
	`invite` text NOT NULL,
	`expires` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved` (
	`user` text NOT NULL,
	`track` text NOT NULL,
	PRIMARY KEY(`user`, `track`)
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`genre` text NOT NULL,
	`bpm` integer NOT NULL,
	`musicalKey` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`permission` text DEFAULT 'listen' NOT NULL,
	`fileId` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tracks_visibility` ON `tracks` (`visibility`);--> statement-breakpoint
CREATE INDEX `idx_tracks_owner` ON `tracks` (`owner`);--> statement-breakpoint
CREATE INDEX `idx_tracks_file` ON `tracks` (`fileId`);