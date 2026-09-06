CREATE TABLE `room_editors` (
	`room` text NOT NULL,
	`project` text NOT NULL,
	`user` text NOT NULL,
	`grantedBy` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`room`, `project`, `user`)
);
--> statement-breakpoint
CREATE INDEX `idx_room_editors_project_user` ON `room_editors` (`project`,`user`);--> statement-breakpoint
ALTER TABLE `project_versions` ADD `author` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `updatedBy` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `lastSaveId` text;