const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const batches = await prisma.batches.findMany();
  console.log(batches.map(b => ({ id: b.id, title: b.title })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
