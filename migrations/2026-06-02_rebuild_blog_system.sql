-- Blog system rebuild for MySQL/MariaDB.
-- This preserves the old `blogs` table as `blogs_legacy` and migrates rows into
-- the new publishing tables used by Prisma.

CREATE TABLE IF NOT EXISTS blogs_legacy LIKE blogs;

INSERT IGNORE INTO blogs_legacy
SELECT * FROM blogs;

CREATE TABLE IF NOT EXISTS blog_authors (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(191) NOT NULL,
  role VARCHAR(191) NULL,
  bio TEXT NULL,
  avatar_url TEXT NULL,
  expertise JSON DEFAULT (JSON_ARRAY()),
  social_links JSON DEFAULT (JSON_OBJECT()),
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
);

CREATE TABLE IF NOT EXISTS blog_topics (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  slug VARCHAR(191) NOT NULL UNIQUE,
  title VARCHAR(191) NOT NULL,
  description TEXT NULL,
  parent_id VARCHAR(36) NULL,
  exam VARCHAR(64) NULL,
  subject VARCHAR(128) NULL,
  chapter VARCHAR(191) NULL,
  sort_order INT DEFAULT 0,
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_blog_topics_parent (parent_id),
  INDEX idx_blog_topics_taxonomy (exam, subject, chapter),
  CONSTRAINT fk_blog_topics_parent FOREIGN KEY (parent_id) REFERENCES blog_topics(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  slug VARCHAR(191) NOT NULL UNIQUE,
  title VARCHAR(191) NOT NULL,
  excerpt TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  cover_image TEXT NULL,
  cover_image_alt TEXT NULL,
  category VARCHAR(128) NULL,
  exam VARCHAR(64) NULL,
  class_level VARCHAR(64) NULL,
  subject VARCHAR(128) NULL,
  chapter VARCHAR(191) NULL,
  author_id VARCHAR(36) NULL,
  topic_id VARCHAR(36) NULL,
  read_time VARCHAR(64) NULL,
  seo_title VARCHAR(191) NULL,
  meta_description TEXT NULL,
  focus_keyword VARCHAR(191) NULL,
  secondary_keywords JSON DEFAULT (JSON_ARRAY()),
  tags JSON DEFAULT (JSON_ARRAY()),
  canonical_url TEXT NULL,
  noindex BOOLEAN NOT NULL DEFAULT FALSE,
  og_title VARCHAR(191) NULL,
  og_description TEXT NULL,
  og_image TEXT NULL,
  content_blocks JSON DEFAULT (JSON_ARRAY()),
  published_at DATETIME(6) NULL,
  scheduled_at DATETIME(6) NULL,
  archived_at DATETIME(6) NULL,
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_blog_posts_status_date (status, published_at),
  INDEX idx_blog_posts_taxonomy (exam, subject, chapter),
  INDEX idx_blog_posts_topic (topic_id),
  INDEX idx_blog_posts_author (author_id),
  INDEX idx_blog_posts_focus_keyword (focus_keyword),
  INDEX idx_blog_posts_updated (updated_at),
  CONSTRAINT fk_blog_posts_author FOREIGN KEY (author_id) REFERENCES blog_authors(id) ON DELETE SET NULL,
  CONSTRAINT fk_blog_posts_topic FOREIGN KEY (topic_id) REFERENCES blog_topics(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS blog_revisions (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  post_id VARCHAR(36) NOT NULL,
  snapshot JSON NOT NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_blog_revisions_post_date (post_id, created_at),
  CONSTRAINT fk_blog_revisions_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blog_assets (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  post_id VARCHAR(36) NULL,
  url TEXT NOT NULL,
  alt_text TEXT NULL,
  caption TEXT NULL,
  mime_type VARCHAR(128) NULL,
  size_bytes BIGINT NULL,
  metadata JSON DEFAULT (JSON_OBJECT()),
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_blog_assets_post (post_id),
  CONSTRAINT fk_blog_assets_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE SET NULL
);

INSERT IGNORE INTO blog_topics (slug, title, description, sort_order)
VALUES
  ('jee', 'JEE', 'JEE preparation articles, strategy, notes, and updates.', 1),
  ('neet', 'NEET', 'NEET preparation articles, strategy, notes, and updates.', 2),
  ('physics', 'Physics', 'Physics concepts, formulas, examples, and PYQ guidance.', 3),
  ('chemistry', 'Chemistry', 'Chemistry concepts, reactions, formulas, and strategy.', 4),
  ('mathematics', 'Mathematics', 'Mathematics concepts, shortcuts, and problem solving.', 5),
  ('biology', 'Biology', 'Biology NCERT, diagrams, and NEET preparation guidance.', 6),
  ('strategy', 'Strategy', 'Study plans, revision systems, and exam temperament.', 7),
  ('updates', 'Updates', 'Exam updates, announcements, and result news.', 8);

INSERT IGNORE INTO blog_authors (name, avatar_url, role)
SELECT DISTINCT
  COALESCE(NULLIF(author_name, ''), 'Dhriti Classes') AS name,
  MAX(author_avatar) AS avatar_url,
  'Dhriti Faculty' AS role
FROM blogs_legacy
GROUP BY COALESCE(NULLIF(author_name, ''), 'Dhriti Classes');

INSERT IGNORE INTO blog_posts (
  id,
  slug,
  title,
  excerpt,
  status,
  cover_image,
  cover_image_alt,
  category,
  author_id,
  read_time,
  seo_title,
  meta_description,
  focus_keyword,
  tags,
  og_title,
  og_description,
  og_image,
  content_blocks,
  published_at,
  created_at,
  updated_at
)
SELECT
  b.id,
  b.slug,
  b.title,
  b.excerpt,
  'PUBLISHED',
  b.cover_image,
  b.title,
  b.category,
  a.id,
  b.read_time,
  CONCAT(LEFT(b.title, 165), ' | Dhriti Classes'),
  b.excerpt,
  CASE
    WHEN JSON_TYPE(b.tags) = 'ARRAY' AND JSON_LENGTH(b.tags) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(b.tags, '$[0]'))
    ELSE b.category
  END,
  COALESCE(b.tags, JSON_ARRAY()),
  b.title,
  b.excerpt,
  b.cover_image,
  COALESCE(b.sections, JSON_ARRAY()),
  COALESCE(CAST(b.published_at AS DATETIME(6)), b.created_at, CURRENT_TIMESTAMP(6)),
  COALESCE(b.created_at, CURRENT_TIMESTAMP(6)),
  COALESCE(b.updated_at, CURRENT_TIMESTAMP(6))
FROM blogs_legacy b
LEFT JOIN blog_authors a
  ON a.name = COALESCE(NULLIF(b.author_name, ''), 'Dhriti Classes');
