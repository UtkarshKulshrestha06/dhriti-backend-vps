const { PrismaClient } = require("@prisma/client");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to initialize Prisma");
}

function createPrismaClient() {
  // Use native Prisma client.
  return new PrismaClient();
}

const prisma = createPrismaClient();

// Handle graceful shutdown to prevent connection leaks during nodemon restarts
const shutdown = async () => {
  console.log("Shutting down Prisma connection...");
  try {
    await prisma.$disconnect();
    console.log("Prisma disconnected successfully.");
  } catch (err) {
    console.error("Error disconnecting Prisma:", err);
  }
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

module.exports = prisma;
