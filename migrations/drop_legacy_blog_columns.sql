-- Drop legacy singular taxonomy columns from blog_posts
-- These are replaced by the JSON array columns: exams, class_levels, subjects, topic_ids

ALTER TABLE `blog_posts` DROP FOREIGN KEY IF EXISTS `blog_posts_topic_id_fkey`;
ALTER TABLE `blog_posts` DROP INDEX IF EXISTS `blog_posts_exam_subject_chapter_idx`;
ALTER TABLE `blog_posts` DROP INDEX IF EXISTS `blog_posts_topic_id_idx`;

ALTER TABLE `blog_posts`
  DROP COLUMN IF EXISTS `exam`,
  DROP COLUMN IF EXISTS `class_level`,
  DROP COLUMN IF EXISTS `subject`,
  DROP COLUMN IF EXISTS `topic_id`;
