require("dotenv").config({ path: "../.env" });
const { PrismaClient } = require("@prisma/client");
const { createClient } = require("@supabase/supabase-js");

const prisma = new PrismaClient();
const supabase = createClient(
    process.env.SUPABASE_URL || "https://tfvnybopztdkpsvohhxj.supabase.co", 
    process.env.SUPABASE_KEY || "YOUR_KEY" // Needs to have the actual key mapped in environment
);

const MIGRATION_BATCH_SIZE = 500;

async function syncTable(tableName, prismaModel, isCompositeKey = false) {
    console.log(`Starting sync for table: ${tableName}`);
    
    let offset = 0;
    let hasMore = true;
    let totalSynced = 0;
    
    while (hasMore) {
        let query = supabase.from(tableName).select("*").range(offset, offset + MIGRATION_BATCH_SIZE - 1);
        
        const { data, error } = await query;

        if (error) {
            console.error(`Error fetching from Supabase [${tableName}]:`, error.message);
            throw error;
        }

        if (!data || data.length === 0) {
            hasMore = false;
            break;
        }

        for (let row of data) {
            try {
                // Pre-process date and time fields to be Prisma compatible
                for (let key in row) {
                    if (row[key] && typeof row[key] === 'string') {
                        if (/^\d{4}-\d{2}-\d{2}$/.test(row[key])) {
                            row[key] = new Date(`${row[key]}T00:00:00Z`);
                        }
                        else if (/^\d{2}:\d{2}:\d{2}$/.test(row[key])) {
                            row[key] = new Date(`1970-01-01T${row[key]}Z`);
                        }
                    }
                }

                if (isCompositeKey) {
                    await prismaModel.createMany({
                         data: [row],
                         skipDuplicates: true
                    });
                } else {
                    const pkField = row.id !== undefined ? 'id' : (row.key !== undefined ? 'key' : null);
                    if (pkField) {
                        await prismaModel.upsert({
                            where: { [pkField]: row[pkField] },
                            create: row,
                            update: row
                        });
                    } else {
                         console.error("No primary key found for row", row);
                    }
                }
                totalSynced++;
            } catch (err) {
                 console.error(`Failed to upsert row in ${tableName}:\n${err.message}\n`);
            }
        }

        offset += MIGRATION_BATCH_SIZE;
        console.log(`Fetched and synced batch from ${tableName}...`);
    }

    console.log(`Finished syncing ${tableName}. Total rows: ${totalSynced}\n`);
}

async function main() {
    console.log("Starting data migration from Supabase to Local PostgreSQL...\n");

    try {
        // Sync tables in order of physical dependencies (parent tables first)
        
        // 2. Academic Core
        await syncTable("streams", prisma.streams);
        await syncTable("batches", prisma.batches);
        await syncTable("subjects", prisma.subjects);
        await syncTable("chapters", prisma.chapters);
        
        // 3. User Dependencies
        await syncTable("enrollments", prisma.enrollments, true);

        // 4. Resources
        await syncTable("resources", prisma.resources);
        await syncTable("freebies", prisma.freebies);
        
        // 5. Communications
        await syncTable("announcements", prisma.announcements);
        await syncTable("inquiries", prisma.inquiries);
        await syncTable("site_content", prisma.siteContent);
        
        // 6. Extracurriculars
        await syncTable("blogs", prisma.blogs);
        await syncTable("notebooks", prisma.notebooks);
        
        // 7. Testing System - Core Tests
        // SKIP tests table as per request; it's handled by import_tests_csv.js
        // await syncTable("tests", prisma.tests);
        
        // 8. Test Dependencies
        await syncTable("test_attempts", prisma.testAttempts);
        
        // 9. Bookmarks & Tags System
        await syncTable("question_tags", prisma.questionTags);
        // Note: Bookmarks and Tags references
        // Bookmarks map tests to notebooks
        await syncTable("bookmarks", prisma.bookmarks);
        await syncTable("bookmark_tag_relations", prisma.bookmarkTagRelations, true);
        
        // 10. Timetables
        await syncTable("timetable", prisma.timetable);

        console.log("\nMigration completed successfully. 🎉");
    } catch (err) {
        console.error("\nMigration halted due to error:", err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
