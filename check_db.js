const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const res = await prisma.resources.findMany({ take: 5 });
  console.log('Resources:', JSON.stringify(res, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  const free = await prisma.freebies.findMany({ take: 5 });
  console.log('Freebies:', JSON.stringify(free, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
