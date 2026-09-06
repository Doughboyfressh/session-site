CREATE TABLE `project_creations` (
	`owner` text NOT NULL,
	`creationKey` text NOT NULL,
	`project` text NOT NULL,
	`requestHash` text NOT NULL,
	`revision` integer NOT NULL,
	`created` integer NOT NULL,
	`deletedAt` integer,
	PRIMARY KEY(`owner`, `creationKey`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_creations_project` ON `project_creations` (`project`);