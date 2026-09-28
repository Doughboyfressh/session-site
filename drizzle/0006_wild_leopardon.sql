CREATE TABLE `collaboration_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`track` text,
	`role` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_collaboration_recipient` ON `collaboration_requests` (`recipient`,`status`,`updated`);--> statement-breakpoint
CREATE INDEX `idx_collaboration_sender` ON `collaboration_requests` (`sender`,`updated`);--> statement-breakpoint
CREATE INDEX `idx_collaboration_track` ON `collaboration_requests` (`track`);--> statement-breakpoint
CREATE TABLE `direct_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`request` text NOT NULL,
	`sender` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	`clientId` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_direct_messages_request` ON `direct_messages` (`request`,`created`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_direct_messages_dedup` ON `direct_messages` (`request`,`sender`,`clientId`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`actor` text,
	`kind` text NOT NULL,
	`resourceType` text NOT NULL,
	`resourceId` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL,
	`readAt` integer,
	`uniqueKey` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_created` ON `notifications` (`user`,`created`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`user`,`readAt`,`created`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notifications_unique` ON `notifications` (`uniqueKey`);--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`user` text NOT NULL,
	`target` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user`, `target`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_blocks_target` ON `user_blocks` (`target`);