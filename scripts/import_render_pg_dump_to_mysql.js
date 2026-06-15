const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DEFAULT_DUMP = "D:\\CODE\\Antigravity Stuff\\DHRITI OFFICIAL\\BACKUPS\\render_backup.sql";

const TABLE_ORDER = [
  "users",
  "streams",
  "batches",
  "subjects",
  "chapters",
  "freebies",
  "inquiries",
  "results",
  "blogs",
  "site_content",
  "tests",
  "test_attempts",
  "timetable",
  "announcements",
  "resources",
  "notebooks",
  "question_tags",
  "bookmarks",
  "bookmark_tag_relations",
  "enrollments"
];

const JSON_COLUMNS = new Map([
  ["blogs", new Set(["sections", "tags"])],
  ["site_content", new Set(["value"])],
  ["tests", new Set(["config", "schedule", "questions", "tags", "answer_key"])],
  ["test_attempts", new Set(["answers", "status", "time_spent", "question_keys", "subject_scores"])],
  ["announcements", new Set(["tags"])]
]);

const ARRAY_COLUMNS = new Map([
  ["blogs", new Set(["tags"])],
  ["tests", new Set(["tags"])],
  ["announcements", new Set(["tags"])]
]);

const BOOLEAN_COLUMNS = new Map([
  ["batches", new Set(["is_active"])],
  ["tests", new Set(["is_free"])],
  ["test_attempts", new Set(["is_submitted"])],
  ["timetable", new Set(["is_compulsory"])],
  ["announcements", new Set(["is_important"])],
  ["results", new Set(["is_hall_of_fame"])],
  ["resources", new Set(["is_free"])]
]);

const DATETIME_COLUMNS = new Map([
  ["users", new Set(["created_at"])],
  ["streams", new Set(["created_at"])],
  ["batches", new Set(["created_at"])],
  ["subjects", new Set(["created_at"])],
  ["chapters", new Set(["created_at"])],
  ["enrollments", new Set(["enrolled_at"])],
  ["freebies", new Set(["created_at"])],
  ["inquiries", new Set(["created_at"])],
  ["resources", new Set(["created_at"])],
  ["site_content", new Set(["updated_at"])],
  ["tests", new Set(["created_at"])],
  ["test_attempts", new Set(["created_at"])],
  ["timetable", new Set(["created_at"])],
  ["announcements", new Set(["created_at"])],
  ["blogs", new Set(["created_at", "updated_at"])],
  ["results", new Set(["created_at", "updated_at"])],
  ["notebooks", new Set(["created_at", "updated_at"])],
  ["question_tags", new Set(["created_at"])],
  ["bookmarks", new Set(["created_at", "updated_at"])],
  ["bookmark_tag_relations", new Set(["created_at"])]
]);

function parseArgs(argv) {
  const args = {
    dump: DEFAULT_DUMP,
    execute: false,
    force: false,
    parseOnly: false,
    verifyOnly: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dump") args.dump = argv[++i];
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--parse-only") args.parseOnly = true;
    else if (arg === "--verify-only") args.verifyOnly = true;
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/import_render_pg_dump_to_mysql.js [--dump path] [--parse-only] [--execute] [--force] [--verify-only]

Defaults:
  Runs in dry-run mode unless --execute is provided.
  Refuses to import into a non-empty database unless --force is provided.
  Uses DATABASE_URL from backend-vps/.env.
`);
}

function unescapePgCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([\\btnrfv])/g, (_, code) => {
    if (code === "b") return "\b";
    if (code === "t") return "\t";
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "f") return "\f";
    if (code === "v") return "\v";
    return "\\";
  });
}

function parsePgArray(value) {
  if (value === null || value === "") return [];
  if (value === "{}") return [];
  const body = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
  const items = [];
  let current = "";
  let quoted = false;
  let escaping = false;

  for (const char of body) {
    if (escaping) {
      current += char;
      escaping = false;
    } else if (char === "\\") {
      escaping = true;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      items.push(current === "NULL" ? null : current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length > 0 || body.endsWith(",")) {
    items.push(current === "NULL" ? null : current);
  }

  return items;
}

function normalizeDateTime(value) {
  if (!value) return value;
  return value
    .replace("T", " ")
    .replace(/\s*(Z|[+-]\d{2}(?::?\d{2})?)$/, "")
    .slice(0, 26);
}

function normalizeTextValue(value) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replace(/Γé╣|â‚¹|₹/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}

function isMapped(map, table, column) {
  return map.get(table)?.has(column) || false;
}

function convertValue(table, column, value) {
  if (value === null) return null;

  if (isMapped(BOOLEAN_COLUMNS, table, column)) {
    return value === "t" || value === "true" || value === "1";
  }

  if (isMapped(ARRAY_COLUMNS, table, column)) {
    return JSON.stringify(parsePgArray(value));
  }

  if (isMapped(JSON_COLUMNS, table, column)) {
    return JSON.stringify(JSON.parse(value));
  }

  if (isMapped(DATETIME_COLUMNS, table, column)) {
    return normalizeDateTime(value);
  }

  return normalizeTextValue(value);
}

async function parseDump(dumpPath) {
  if (!fs.existsSync(dumpPath)) {
    throw new Error(`Dump file not found: ${dumpPath}`);
  }

  const fd = fs.openSync(dumpPath, "r");
  const firstBytes = Buffer.alloc(2);
  fs.readSync(fd, firstBytes, 0, 2, 0);
  fs.closeSync(fd);
  const encoding = firstBytes[0] === 0xff && firstBytes[1] === 0xfe ? "utf16le" : "utf8";
  const tables = new Map();
  let current = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(dumpPath, { encoding }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const normalizedLine = line.replace(/^\uFEFF/, "");
    const copyMatch = normalizedLine.match(/^COPY public\.([^\s]+) \((.+)\) FROM stdin;$/);
    if (copyMatch) {
      current = {
        table: copyMatch[1],
        columns: copyMatch[2].split(", "),
        rows: []
      };
      tables.set(current.table, current);
      continue;
    }

    if (!current) continue;

    if (normalizedLine === "\\.") {
      current = null;
      continue;
    }

    const rawValues = normalizedLine.split("\t").map(unescapePgCopyValue);
    if (rawValues.length !== current.columns.length) {
      throw new Error(
        `Column/value mismatch in ${current.table}: expected ${current.columns.length}, got ${rawValues.length}`
      );
    }

    const values = rawValues.map((value, index) =>
      convertValue(current.table, current.columns[index], value)
    );
    current.rows.push(values);
  }

  return tables;
}

async function connect() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }
  return mysql.createConnection(process.env.DATABASE_URL);
}

async function getCurrentCounts(connection, tables) {
  const counts = new Map();
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts.set(table, Number(rows[0].count));
  }
  return counts;
}

function printCounts(title, counts) {
  console.log(title);
  for (const table of TABLE_ORDER) {
    if (counts.has(table)) {
      console.log(`  ${table}: ${counts.get(table)}`);
    }
  }
}

async function importRows(connection, tables) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  await connection.beginTransaction();
  try {
    for (const tableName of TABLE_ORDER) {
      const table = tables.get(tableName);
      if (!table || table.rows.length === 0) continue;

      const columns = table.columns.map((column) => `\`${column}\``).join(", ");
      const placeholders = table.columns.map(() => "?").join(", ");
      const sql = `INSERT INTO \`${tableName}\` (${columns}) VALUES (${placeholders})`;

      for (const row of table.rows) {
        await connection.execute(sql, row);
      }

      console.log(`Imported ${table.rows.length} rows into ${tableName}`);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tables = await parseDump(args.dump);
  const expectedCounts = new Map(
    Array.from(tables.entries()).map(([table, data]) => [table, data.rows.length])
  );

  printCounts("Rows found in PostgreSQL dump:", expectedCounts);

  if (args.parseOnly) {
    console.log("Parse-only mode complete. No MySQL connection was opened.");
    return;
  }

  const connection = await connect();
  try {
    const existingCounts = await getCurrentCounts(connection, TABLE_ORDER);
    printCounts("Current MySQL row counts:", existingCounts);

    const nonEmpty = Array.from(existingCounts.entries()).filter(([, count]) => count > 0);
    if (!args.verifyOnly && args.execute && nonEmpty.length > 0 && !args.force) {
      throw new Error(
        `Refusing to import into a non-empty database. Non-empty tables: ${nonEmpty
          .map(([table, count]) => `${table}=${count}`)
          .join(", ")}. Use --force only after taking a backup.`
      );
    }

    if (args.verifyOnly) {
      return;
    }

    if (!args.execute) {
      console.log("Dry run only. Re-run with --execute to import into MySQL.");
      return;
    }

    await importRows(connection, tables);
    const finalCounts = await getCurrentCounts(connection, TABLE_ORDER);
    printCounts("Final MySQL row counts:", finalCounts);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
