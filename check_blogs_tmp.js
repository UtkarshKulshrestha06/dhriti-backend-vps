const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.blogPost.findMany({
    orderBy: { created_at: 'desc' },
    take: 3,
    select: { id: true, title: true, cover_image: true }
  });
  console.log(JSON.stringify(posts, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
