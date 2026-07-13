CREATE INDEX `idx_album_photos_album_id` ON `album_photos` (`album_id`);--> statement-breakpoint
CREATE INDEX `idx_album_photos_photo_id` ON `album_photos` (`photo_id`);--> statement-breakpoint
CREATE INDEX `idx_photos_date_taken` ON `photos` (`date_taken`);--> statement-breakpoint
CREATE INDEX `idx_photos_storage_key` ON `photos` (`storage_key`);