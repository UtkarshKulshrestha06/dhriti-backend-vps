-- Applied in production through scripts/apply_tests_global_assignments.js.
-- Keep this SQL as the schema reference; use the script for idempotent re-runs.

ALTER TABLE tests
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6);

CREATE TABLE IF NOT EXISTS test_assignments (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  test_id VARCHAR(36) NOT NULL,
  audience_type VARCHAR(32) NOT NULL,
  batch_id VARCHAR(191) NULL,
  status VARCHAR(32) DEFAULT 'ACTIVE',
  schedule JSON DEFAULT (JSON_OBJECT()),
  allow_reattempts BOOLEAN DEFAULT TRUE,
  leaderboard_enabled BOOLEAN DEFAULT TRUE,
  solutions_release_policy JSON DEFAULT (JSON_OBJECT()),
  sort_order INT DEFAULT 0,
  created_by VARCHAR(36) NULL,
  created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_test_assignments_test_id (test_id),
  INDEX idx_test_assignments_batch_id (batch_id),
  INDEX idx_test_assignments_audience_status (audience_type, status),
  CONSTRAINT test_assignments_test_fkey FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
  CONSTRAINT test_assignments_batch_fkey FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  CONSTRAINT test_assignments_user_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE test_attempts
  ADD COLUMN IF NOT EXISTS test_assignment_id VARCHAR(36) NULL;

UPDATE tests
SET status = 'ARCHIVED'
WHERE status IS NULL OR status = 'DRAFT';
