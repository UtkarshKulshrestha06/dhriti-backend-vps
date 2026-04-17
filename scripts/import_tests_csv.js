require("dotenv").config({ path: "../.env" });
const { PrismaClient } = require("@prisma/client");
const fs = require('fs');
const csv = require('csv-parser');

const prisma = new PrismaClient();

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("Starting tests import from CSV...");
    
    const filePath = "D:\\CODE\\Antigravity Stuff\\DHRITI OFFICIAL\\BACKUPS\\DATABASE\\tests_rows.csv";
    
    const tests = [];
    
    fs.createReadStream(filePath)
      .pipe(csv({
          headers: [
              'id', 
              'batch_id', 
              'name', 
              'config', 
              'schedule', 
              'questions', 
              'duration_minutes', 
              'created_by', 
              'created_at', 
              'tags', 
              'answer_key', 
              'is_free', 
              'test_type'
          ],
          skipLines: 0 // Assume no headers
      }))
      .on('data', (row) => {
          tests.push(row);
      })
      .on('end', async () => {
          console.log(`CSV parsed. Found ${tests.length} tests.`);
          
          let totalSynced = 0;
          for (const row of tests) {
              try {
                  // Handle JSON parsing
                  const config = row.config ? JSON.parse(row.config) : {};
                  const schedule = row.schedule ? JSON.parse(row.schedule) : {};
                  const questions = row.questions ? JSON.parse(row.questions) : [];
                  const answer_key = row.answer_key ? JSON.parse(row.answer_key) : {};
                  
                  // Handle Boolean
                  const is_free = row.is_free === 'true' || row.is_free === 't' || row.is_free === '1';
                  
                  // Handle numbers
                  const duration_minutes = parseInt(row.duration_minutes, 10) || 180;
                  
                  // Handle arrays (Supabase {} syntax for strings)
                  let tags = [];
                  if (row.tags && row.tags !== '{}' && row.tags !== '[]') {
                      let tStr = row.tags.trim();
                      if (tStr.startsWith('{') && tStr.endsWith('}')) {
                          tStr = tStr.substring(1, tStr.length - 1);
                          tags = tStr.split(',').map(s => s.trim());
                      } else if (tStr.startsWith('[') && tStr.endsWith(']')) {
                          try {
                              tags = JSON.parse(tStr);
                          } catch (e) {
                              tags = [];
                          }
                      }
                  }

                  // Handle Dates
                  const created_at = row.created_at ? new Date(row.created_at) : new Date();

                  const batch_id = row.batch_id === '' || row.batch_id === 'null' ? null : row.batch_id;
                  const created_by = row.created_by === '' || row.created_by === 'null' ? null : row.created_by;

                  await prisma.tests.upsert({
                      where: { id: row.id },
                      create: {
                          id: row.id,
                          batch_id,
                          name: row.name,
                          config,
                          schedule,
                          questions,
                          duration_minutes,
                          created_by,
                          created_at,
                          tags,
                          answer_key,
                          is_free,
                          test_type: row.test_type
                      },
                      update: {
                          batch_id,
                          name: row.name,
                          config,
                          schedule,
                          questions,
                          duration_minutes,
                          created_by,
                          created_at,
                          tags,
                          answer_key,
                          is_free,
                          test_type: row.test_type
                      }
                  });
                  totalSynced++;
              } catch (err) {
                  console.error(`Failed to upsert test ${row.id}:`, err.message);
              }
          }
          
          console.log(`Successfully imported ${totalSynced} tests.`);
          await prisma.$disconnect();
      });
}

main();
