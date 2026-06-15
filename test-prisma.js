const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("Connecting...");
    await prisma.$connect();
    console.log("Connected successfully!");
    
    console.log("Testing a query...");
    const user = await prisma.user.findFirst();
    console.log("Query success! User:", user ? user.email : "none");
  } catch (e) {
    console.error("Connection failed:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
