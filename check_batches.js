const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const batches = await prisma.batches.findMany({ include: { stream: true }, take: 5 });
  console.log(JSON.stringify(batches, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
