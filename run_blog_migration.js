const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function dropIfExists(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`Dropped: ${label}`);
  } catch (e) {
    console.log(`Not found / skipping: ${label}`);
  }
}

async function main() {
  console.log('Running migration: drop legacy singular taxonomy columns from blog_posts...\n');
  
  // 1. Drop foreign key constraints first (must be done before dropping the column)
  await dropIfExists('FK blog_posts_topic_id_fkey', `ALTER TABLE \`blog_posts\` DROP FOREIGN KEY \`blog_posts_topic_id_fkey\``);

  // Try common auto-generated FK names on Hostinger
  await dropIfExists('FK blog_posts_ibfk_1', `ALTER TABLE \`blog_posts\` DROP FOREIGN KEY \`blog_posts_ibfk_1\``);
  await dropIfExists('FK blog_posts_ibfk_2', `ALTER TABLE \`blog_posts\` DROP FOREIGN KEY \`blog_posts_ibfk_2\``);

  // 2. Find and drop any FK that references blog_topics via topic_id
  const fks = await prisma.$queryRaw`
    SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_NAME = 'blog_posts'
      AND COLUMN_NAME = 'topic_id'
      AND CONSTRAINT_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME = 'blog_topics'
  `;
  for (const fk of fks) {
    await dropIfExists(`FK ${fk.CONSTRAINT_NAME}`, `ALTER TABLE \`blog_posts\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
  }

  // 3. Drop indexes on the columns being removed
  const indexes = await prisma.$queryRaw`
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_NAME = 'blog_posts'
      AND COLUMN_NAME IN ('exam', 'class_level', 'subject', 'topic_id')
      AND TABLE_SCHEMA = DATABASE()
      AND INDEX_NAME != 'PRIMARY'
  `;
  const uniqueIndexes = [...new Set(indexes.map(i => i.INDEX_NAME))];
  for (const idx of uniqueIndexes) {
    await dropIfExists(`Index ${idx}`, `ALTER TABLE \`blog_posts\` DROP INDEX \`${idx}\``);
  }

  // 4. Drop the legacy columns
  await prisma.$executeRawUnsafe(`
    ALTER TABLE \`blog_posts\`
      DROP COLUMN IF EXISTS \`exam\`,
      DROP COLUMN IF EXISTS \`class_level\`,
      DROP COLUMN IF EXISTS \`subject\`,
      DROP COLUMN IF EXISTS \`topic_id\`
  `);
  console.log('\n✅ Legacy columns dropped!');
  
  // 5. Verify
  const result = await prisma.$queryRaw`SHOW COLUMNS FROM blog_posts`;
  const columnNames = result.map(r => r.Field);
  console.log('\nCurrent blog_posts columns:', columnNames.join(', '));
  
  const legacyCols = ['exam', 'class_level', 'subject', 'topic_id'];
  const remaining = legacyCols.filter(c => columnNames.includes(c));
  if (remaining.length === 0) {
    console.log('\n✅ All legacy columns successfully removed!');
  } else {
    console.log('\n⚠️  These legacy columns still exist:', remaining);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
