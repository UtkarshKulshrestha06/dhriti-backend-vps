-- Add multi-select blog metadata support while preserving old single-value columns.

ALTER TABLE blog_posts
  ADD COLUMN exams JSON DEFAULT (JSON_ARRAY()),
  ADD COLUMN class_levels JSON DEFAULT (JSON_ARRAY()),
  ADD COLUMN subjects JSON DEFAULT (JSON_ARRAY()),
  ADD COLUMN topic_ids JSON DEFAULT (JSON_ARRAY());

UPDATE blog_posts
SET
  exams = CASE
    WHEN JSON_LENGTH(COALESCE(exams, JSON_ARRAY())) > 0 THEN exams
    WHEN exam IS NOT NULL AND exam <> '' THEN JSON_ARRAY(exam)
    ELSE JSON_ARRAY()
  END,
  class_levels = CASE
    WHEN JSON_LENGTH(COALESCE(class_levels, JSON_ARRAY())) > 0 THEN class_levels
    WHEN class_level IS NOT NULL AND class_level <> '' THEN JSON_ARRAY(class_level)
    ELSE JSON_ARRAY()
  END,
  subjects = CASE
    WHEN JSON_LENGTH(COALESCE(subjects, JSON_ARRAY())) > 0 THEN subjects
    WHEN subject IS NOT NULL AND subject <> '' THEN JSON_ARRAY(subject)
    ELSE JSON_ARRAY()
  END,
  topic_ids = CASE
    WHEN JSON_LENGTH(COALESCE(topic_ids, JSON_ARRAY())) > 0 THEN topic_ids
    WHEN topic_id IS NOT NULL AND topic_id <> '' THEN JSON_ARRAY(topic_id)
    ELSE JSON_ARRAY()
  END;

INSERT IGNORE INTO blog_topics (slug, title, description, sort_order)
VALUES ('discussion', 'Discussion', 'Discussion-led articles, opinions, doubts, and student conversations.', 9);
