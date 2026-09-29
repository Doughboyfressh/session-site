ALTER TABLE `profiles` ADD `rates` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `tracks` ADD `price` integer;--> statement-breakpoint
CREATE TABLE `stripe_accounts` (
	`user` text NOT NULL PRIMARY KEY,
	`accountId` text NOT NULL,
	`chargesEnabled` integer NOT NULL DEFAULT 0,
	`payoutsEnabled` integer NOT NULL DEFAULT 0,
	`details` text NOT NULL DEFAULT '{}',
	`created` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text NOT NULL PRIMARY KEY,
	`kind` text NOT NULL,
	`track` text,
	`seller` text NOT NULL,
	`buyer` text NOT NULL,
	`serviceSnapshot` text NOT NULL DEFAULT '{}',
	`amountCents` integer NOT NULL,
	`feeCents` integer NOT NULL DEFAULT 0,
	`currency` text NOT NULL DEFAULT 'usd',
	`status` text NOT NULL DEFAULT 'pending',
	`stripeSessionId` text NOT NULL DEFAULT '',
	`paymentIntent` text,
	`created` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_orders_seller_created` ON `orders` (`seller`,`created`);--> statement-breakpoint
CREATE INDEX `idx_orders_buyer_created` ON `orders` (`buyer`,`created`);--> statement-breakpoint
CREATE INDEX `idx_orders_session` ON `orders` (`stripeSessionId`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`eventId` text NOT NULL PRIMARY KEY,
	`processedAt` integer NOT NULL
);
