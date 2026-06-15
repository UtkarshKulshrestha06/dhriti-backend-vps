const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const migrationPath = path.join(__dirname, '..', 'migrations', '2026-06-02_rebuild_blog_system.sql');
const execute = process.argv.includes('--execute');

const splitSql = (sql) => {
  const withoutLineComments = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutLineComments
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
};

const describeTarget = (databaseUrl) => {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '3306',
    database: url.pathname.replace(/^\//, ''),
    user: url.username ? '<set>' : '<empty>',
  };
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  const statements = splitSql(sql);
  const target = describeTarget(process.env.DATABASE_URL);

  console.log('[blog-migration] Target:', JSON.stringify(target));
  console.log(`[blog-migration] Statements: ${statements.length}`);

  if (!execute) {
    console.log('[blog-migration] Dry run only. Re-run with --execute to apply.');
    return;
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    for (const [index, statement] of statements.entries()) {
      console.log(`[blog-migration] Running ${index + 1}/${statements.length}`);
      await connection.query(statement);
    }
    console.log('[blog-migration] Complete.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('[blog-migration] Failed:', error);
  process.exitCode = 1;
});
