const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.batches.delete({
      where: { id: 'full_syllabus' }
    });
    console.log('Deleted full_syllabus batch');
  } catch (err) {
    if (err.code === 'P2025') {
      console.log('Batch already deleted or not found');
    } else {
      throw err;
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
