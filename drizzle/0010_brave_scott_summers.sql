ALTER TABLE `tracks` ADD `plays` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `rooms` ADD `visibility` text NOT NULL DEFAULT 'invite';
