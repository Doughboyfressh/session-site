ALTER TABLE `collaboration_requests` ADD `trackTitle` text;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `scopeKey` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `senderName` text DEFAULT 'SESSION member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `senderUsername` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `senderAvatar` text;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `recipientName` text DEFAULT 'SESSION member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `recipientUsername` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `recipientAvatar` text;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `operationId` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collaboration_active_scope_unique` ON `collaboration_requests` (`scopeKey`) WHERE "collaboration_requests"."status" IN ('pending','accepted');