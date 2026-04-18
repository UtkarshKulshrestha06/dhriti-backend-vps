const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

// The precise order is critical to satisfy foreign key constraints
const TABLE_ORDER = [
    'users',
    'streams',
    'batches',
    'enrollments'
];

async function migrateData() {
    console.log("=========================================");
    console.log("   DHRITI DB MIGRATION: LOCAL -> RENDER  ");
    console.log("=========================================\n");

    const sourceUrl = process.env.DATABASE_URL; // Local DB from .env
    console.log(`SOURCE DB: ${sourceUrl ? "Found in .env" : "MISSING!"}`);
    
    if (!sourceUrl) {
        console.error("Error: DATABASE_URL not found in .env");
        process.exit(1);
    }

    const targetUrl = await askQuestion("\nPaste your RENDER EXTERNAL DATABASE URL: ");
    
    if (!targetUrl || !targetUrl.startsWith('postgres')) {
        console.error("Invalid database URL.");
        process.exit(1);
    }

    console.log("\nConnecting to databases...");

    const sourceClient = new Client({ connectionString: sourceUrl });
    const targetClient = new Client({ 
        connectionString: targetUrl,
        ssl: { rejectUnauthorized: false } // Required for Render external connections
    });

    try {
        await sourceClient.connect();
        console.log("✅ Connected to Source DB (Local)");

        await targetClient.connect();
        console.log("✅ Connected to Target DB (Render)\n");

        console.log("Disabling foreign key checks temporarily on Target DB...");
        // Disable triggers to avoid foreign key issues if there's any slight order mismatch
        for (const table of TABLE_ORDER) {
            try {
                await targetClient.query(`ALTER TABLE "${table}" DISABLE TRIGGER ALL;`);
            } catch (e) {
                // Table might not exist yet if schema wasn't pushed
                console.log(`Warning: Could not disable triggers for ${table}. Did you run 'npx prisma db push' first?`);
            }
        }

        for (const table of TABLE_ORDER) {
            console.log(`\n📦 Migrating table: ${table}...`);
            
            // Read from source
            const { rows } = await sourceClient.query(`SELECT * FROM "${table}"`);
            
            if (rows.length === 0) {
                console.log(`   -> 0 rows found. Skipping.`);
                continue;
            }

            console.log(`   -> Found ${rows.length} rows. Inserting to Render...`);

            // Clear existing data in target table to avoid unique constraint violations
            await targetClient.query(`TRUNCATE TABLE "${table}" CASCADE;`);

            // Insert data into target
            // We build a parameterized query to handle special characters and SQL injection safely
            const columns = Object.keys(rows[0]);
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            const queryText = `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES (${placeholders})`;

            let successCount = 0;
            let errorCount = 0;

            // Batch processing can be added here for huge tables, but row-by-row is safe and provides detailed error tracking
            for (const row of rows) {
                const values = columns.map(col => {
                    const val = row[col];
                    // Convert objects/arrays back to JSON strings, except for Dates
                    if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
                        return JSON.stringify(val);
                    }
                    return val;
                });
                try {
                    await targetClient.query(queryText, values);
                    successCount++;
                } catch (err) {
                    errorCount++;
                    if (errorCount === 1) {
                        console.error(`   ❌ Example Error on row:`, err.message);
                    }
                }
            }

            console.log(`   -> ✅ Successfully migrated ${successCount} rows.`);
            if (errorCount > 0) {
                console.error(`   -> ⚠️ Failed to migrate ${errorCount} rows.`);
            }
        }

        console.log("\nRe-enabling foreign key checks on Target DB...");
        for (const table of TABLE_ORDER) {
            try {
                await targetClient.query(`ALTER TABLE "${table}" ENABLE TRIGGER ALL;`);
            } catch (e) {
                // Ignore errors here
            }
        }

        console.log("\n🎉 MIGRATION COMPLETE! 🎉");

    } catch (err) {
        console.error("\n❌ MIGRATION FAILED:", err);
    } finally {
        await sourceClient.end();
        await targetClient.end();
        rl.close();
    }
}

migrateData();
