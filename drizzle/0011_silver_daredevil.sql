CREATE TABLE `posts` (
	`id` text NOT NULL PRIMARY KEY,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`fileId` text NOT NULL,
	`track` text,
	`caption` text NOT NULL DEFAULT '',
	`visibility` text NOT NULL DEFAULT 'public',
	`plays` integer NOT NULL DEFAULT 0,
	`created` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_posts_owner_created` ON `posts` (`owner`,`created`);--> statement-breakpoint
CREATE INDEX `idx_posts_visibility_created` ON `posts` (`visibility`,`created`);--> statement-breakpoint
CREATE TABLE `post_likes` (
	`user` text NOT NULL,
	`post` text NOT NULL,
	PRIMARY KEY(`user`, `post`)
);--> statement-breakpoint
CREATE INDEX `idx_post_likes_post` ON `post_likes` (`post`);
