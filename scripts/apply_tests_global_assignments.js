const mysql = require("mysql2/promise");
require("dotenv").config();

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].count) > 0;
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows[0].count) > 0;
}

async function indexExists(connection, table, indexName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return Number(rows[0].count) > 0;
}

async function constraintExists(connection, table, constraintName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, constraintName]
  );
  return Number(rows[0].count) > 0;
}

async function addColumn(connection, table, column, sql) {
  if (!(await columnExists(connection, table, column))) {
    await connection.query(sql);
    console.log(`Added ${table}.${column}`);
  }
}

async function addIndex(connection, table, indexName, sql) {
  if (!(await indexExists(connection, table, indexName))) {
    await connection.query(sql);
    console.log(`Added index ${indexName}`);
  }
}

async function addConstraint(connection, table, constraintName, sql) {
  if (!(await constraintExists(connection, table, constraintName))) {
    await connection.query(sql);
    console.log(`Added constraint ${constraintName}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    await addColumn(
      connection,
      "tests",
      "status",
      "ALTER TABLE tests ADD COLUMN status VARCHAR(32) DEFAULT 'DRAFT'"
    );
    await addColumn(
      connection,
      "tests",
      "updated_at",
      "ALTER TABLE tests ADD COLUMN updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)"
    );

    if (!(await tableExists(connection, "test_assignments"))) {
      await connection.query(`
        CREATE TABLE test_assignments (
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
          updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)
        )
      `);
      console.log("Created test_assignments");
    }

    await addIndex(connection, "test_assignments", "idx_test_assignments_test_id", "CREATE INDEX idx_test_assignments_test_id ON test_assignments(test_id)");
    await addIndex(connection, "test_assignments", "idx_test_assignments_batch_id", "CREATE INDEX idx_test_assignments_batch_id ON test_assignments(batch_id)");
    await addIndex(connection, "test_assignments", "idx_test_assignments_audience_status", "CREATE INDEX idx_test_assignments_audience_status ON test_assignments(audience_type, status)");

    await addConstraint(connection, "test_assignments", "test_assignments_test_fkey", "ALTER TABLE test_assignments ADD CONSTRAINT test_assignments_test_fkey FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE");
    await addConstraint(connection, "test_assignments", "test_assignments_batch_fkey", "ALTER TABLE test_assignments ADD CONSTRAINT test_assignments_batch_fkey FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL");
    await addConstraint(connection, "test_assignments", "test_assignments_user_fkey", "ALTER TABLE test_assignments ADD CONSTRAINT test_assignments_user_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL");

    await addColumn(
      connection,
      "test_attempts",
      "test_assignment_id",
      "ALTER TABLE test_attempts ADD COLUMN test_assignment_id VARCHAR(36) NULL"
    );
    await addIndex(connection, "test_attempts", "idx_test_attempts_assignment_id", "CREATE INDEX idx_test_attempts_assignment_id ON test_attempts(test_assignment_id)");
    await addConstraint(connection, "test_attempts", "test_attempts_assignment_fkey", "ALTER TABLE test_attempts ADD CONSTRAINT test_attempts_assignment_fkey FOREIGN KEY (test_assignment_id) REFERENCES test_assignments(id) ON DELETE SET NULL");

    const [result] = await connection.query(
      "UPDATE tests SET status = 'ARCHIVED' WHERE status IS NULL OR status = 'DRAFT'"
    );
    console.log(`Archived existing tests: ${result.affectedRows}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
