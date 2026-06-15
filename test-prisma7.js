const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
async function main() {
  const prisma = new PrismaClient();
  try {
    const test = await prisma.tests.findFirst({where: { config: { not: {} } }, select: { name: true, config: true } });
    console.log(JSON.stringify(test, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main();
