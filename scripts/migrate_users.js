const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const targetPrisma = new PrismaClient();

async function migrateUsers() {
  try {
    console.log('🔗 Connecting to local database...');
    
    // Read the file dumped by MCP (it's a JSON object itself)
    const rawFile = fs.readFileSync('C:/Users/hp/.gemini/antigravity/brain/147b3ed2-814d-4f40-b57b-7ace10affe22/.system_generated/steps/218/output.txt', 'utf8');
    const parsedFile = JSON.parse(rawFile);
    const dumpData = parsedFile.result || parsedFile.output || rawFile;

    // Extract everything between [ and ] safely
    const startIndex = dumpData.indexOf('[');
    const endIndex = dumpData.lastIndexOf(']');
    
    if (startIndex === -1 || endIndex === -1) {
        throw new Error('Could not parse JSON array from MCP output');
    }

    const arrayStr = dumpData.substring(startIndex, endIndex + 1);
    const users = JSON.parse(arrayStr);
    console.log(`✅ Found ${users.length} users to migrate.`);

    console.log('📤 Migrating to new local database...');

    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        await targetPrisma.user.upsert({
          where: { email: user.email },
          update: {},
          create: {
            id: user.id,
            email: user.email,
            password: user.password,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone || null,
            role: user.role === 'ADMIN' ? 'ADMIN' : 
                  user.role === 'TEACHER' ? 'TEACHER' : 
                  user.role === 'STUDENT' ? 'STUDENT' : 'USER',
            subject: user.subject || null,
            avatar_url: user.avatar_url || null,
            created_at: new Date(user.created_at)
          }
        });
        successCount++;
      } catch (err) {
        console.error(`❌ Failed to migrate user ${user.email}`, err.message);
        failCount++;
      }
    }

    console.log('-----------------------------------');
    console.log(`🎉 Migration Complete!`);
    console.log(`  - Successfully Migrated: ${successCount}`);
    console.log(`  - Failed: ${failCount}`);

  } catch (error) {
    console.error('Migration crashed:', error);
  } finally {
    await targetPrisma.$disconnect();
  }
}

migrateUsers();
