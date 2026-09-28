ALTER TABLE `collaboration_requests` ADD `trackTitle` text;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `scopeKey` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `senderName` text DEFAULT 'SESSION member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `senderUsername` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `senderAvatar` text;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `recipientName` text DEFAULT 'SESSION member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `recipientUsername` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `recipientAvatar` text;--> statement-breakpoint
ALTER TABLE `collaboration_requests` ADD `operationId` text;--> statement-breakpoint
UPDATE `collaboration_requests`
SET
	`trackTitle` = CASE
		WHEN `track` IS NULL THEN NULL
		ELSE (SELECT `title` FROM `tracks` WHERE `tracks`.`id` = `collaboration_requests`.`track`)
	END,
	`scopeKey` = CASE
		WHEN `track` IS NOT NULL THEN 'track:' || json_array(`sender`, `recipient`, `track`)
		WHEN `sender` < `recipient` THEN 'profile:' || json_array(`sender`, `recipient`)
		ELSE 'profile:' || json_array(`recipient`, `sender`)
	END,
	`senderName` = COALESCE((SELECT `name` FROM `profiles` WHERE `profiles`.`id` = `collaboration_requests`.`sender` AND `profiles`.`visibility` = 'public'), 'SESSION member'),
	`senderUsername` = COALESCE((SELECT `username` FROM `profiles` WHERE `profiles`.`id` = `collaboration_requests`.`sender` AND `profiles`.`visibility` = 'public'), 'member'),
	`senderAvatar` = (SELECT `avatar` FROM `profiles` WHERE `profiles`.`id` = `collaboration_requests`.`sender` AND `profiles`.`visibility` = 'public'),
	`recipientName` = COALESCE((SELECT `name` FROM `profiles` WHERE `profiles`.`id` = `collaboration_requests`.`recipient` AND `profiles`.`visibility` = 'public'), 'SESSION member'),
	`recipientUsername` = COALESCE((SELECT `username` FROM `profiles` WHERE `profiles`.`id` = `collaboration_requests`.`recipient` AND `profiles`.`visibility` = 'public'), 'member'),
	`recipientAvatar` = (SELECT `avatar` FROM `profiles` WHERE `profiles`.`id` = `collaboration_requests`.`recipient` AND `profiles`.`visibility` = 'public');--> statement-breakpoint
UPDATE `collaboration_requests`
SET `status` = 'closed', `operationId` = 'migration-scope-dedupe:' || `id`
WHERE `status` IN ('pending', 'accepted')
	AND EXISTS (
		SELECT 1
		FROM `collaboration_requests` AS `keeper`
		WHERE `keeper`.`scopeKey` = `collaboration_requests`.`scopeKey`
			AND `keeper`.`status` IN ('pending', 'accepted')
			AND (
				`keeper`.`created` < `collaboration_requests`.`created`
				OR (`keeper`.`created` = `collaboration_requests`.`created` AND `keeper`.`id` < `collaboration_requests`.`id`)
			)
	);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_collaboration_active_scope_unique` ON `collaboration_requests` (`scopeKey`) WHERE "collaboration_requests"."status" IN ('pending','accepted');
