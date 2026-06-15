const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.batches.upsert({
    where: { id: 'full_syllabus' },
    update: { title: 'Full Syllabus' },
    create: { id: 'full_syllabus', title: 'Full Syllabus', is_active: true }
  });
  console.log('Added full_syllabus batch');
}

main().catch(console.error).finally(() => prisma.$disconnect());
