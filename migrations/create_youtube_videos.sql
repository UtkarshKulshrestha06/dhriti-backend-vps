CREATE TABLE IF NOT EXISTS `youtube_videos` (
  `id` varchar(36) NOT NULL,
  `youtube_url` text NOT NULL,
  `video_id` varchar(32) NOT NULL,
  `custom_title` text NULL,
  `youtube_title` text NOT NULL,
  `thumbnail_url` text NOT NULL,
  `channel_name` varchar(255) NULL,
  `duration` varchar(32) NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `youtube_videos_video_id_key` (`video_id`)
);

INSERT INTO `youtube_videos` (`id`, `youtube_url`, `video_id`, `custom_title`, `youtube_title`, `thumbnail_url`, `channel_name`, `duration`, `sort_order`, `is_active`)
VALUES
  ('5ee89e1e-4f8f-4b40-b3ef-2c5b8f4b8001', 'https://www.youtube.com/watch?v=5M44H6vrFRA', '5M44H6vrFRA', NULL, 'Complex Numbers Lecture 4 | Class 11 Mathematics | JEE Main & Advanced | RK Sir #complexnumbers', 'https://i.ytimg.com/vi/5M44H6vrFRA/maxresdefault.jpg', 'Dhriti Classes', '1:00:33', 0, 1),
  ('5ee89e1e-4f8f-4b40-b3ef-2c5b8f4b8002', 'https://www.youtube.com/watch?v=UYrDYVnUX-4', 'UYrDYVnUX-4', NULL, 'Complex Numbers Lecture 2 | Class 11 Mathematics | JEE Main & Advanced | RK Sir #complexnumbers', 'https://i.ytimg.com/vi/UYrDYVnUX-4/maxresdefault.jpg', 'Dhriti Classes', '1:03:50', 1, 1),
  ('5ee89e1e-4f8f-4b40-b3ef-2c5b8f4b8003', 'https://www.youtube.com/watch?v=1ItT-FMe9lQ', '1ItT-FMe9lQ', NULL, 'Complex Numbers Lecture 1 | Class 11 Mathematics | JEE Main & Advanced | RK Sir #complexnumbers', 'https://i.ytimg.com/vi/1ItT-FMe9lQ/maxresdefault.jpg', 'Dhriti Classes', '56:15', 2, 1),
  ('5ee89e1e-4f8f-4b40-b3ef-2c5b8f4b8004', 'https://www.youtube.com/watch?v=VnQpXg5MY_s', 'VnQpXg5MY_s', NULL, 'Complex Numbers Lecture 2 | Class 11 Mathematics | JEE Main & Advanced | RK Sir #complexnumbers', 'https://i.ytimg.com/vi/VnQpXg5MY_s/maxresdefault_live.jpg', 'Dhriti Classes', '0:03', 3, 1)
ON DUPLICATE KEY UPDATE
  `youtube_url` = VALUES(`youtube_url`),
  `custom_title` = VALUES(`custom_title`),
  `youtube_title` = VALUES(`youtube_title`),
  `thumbnail_url` = VALUES(`thumbnail_url`),
  `channel_name` = VALUES(`channel_name`),
  `duration` = VALUES(`duration`),
  `sort_order` = VALUES(`sort_order`),
  `is_active` = VALUES(`is_active`),
  `updated_at` = CURRENT_TIMESTAMP(6);
