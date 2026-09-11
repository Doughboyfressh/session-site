CREATE TABLE `take_bank_files` (
	`bank` text NOT NULL,
	`take` text NOT NULL,
	`owner` text NOT NULL,
	`project` text NOT NULL,
	`file` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`frames` integer NOT NULL,
	`sampleRate` integer NOT NULL,
	`depth` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`bank`, `take`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_take_bank_files_file` ON `take_bank_files` (`file`);--> statement-breakpoint
CREATE INDEX `idx_take_bank_files_owner` ON `take_bank_files` (`owner`);--> statement-breakpoint
CREATE TABLE `take_banks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`project` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer NOT NULL,
	`updated` integer NOT NULL,
	`lastSaveId` text NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE INDEX `idx_take_banks_owner` ON `take_banks` (`owner`);