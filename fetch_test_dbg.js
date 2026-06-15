const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const testId = '75262d9c-d071-4725-b23a-f6b731ed82ce';
  const test = await prisma.tests.findUnique({
    where: { id: testId },
    include: { testAttempts: true }
  });
  
  if (!test) {
    console.log("Test not found");
    return;
  }
  
  console.log("TEST ID:", test.id);
  console.log("TEST TITLE:", test.title);
  console.log("TEST ENGINE:", test.engine);
  console.log("TEST HAS QUESTIONS:", !!test.questions, "TYPE:", typeof test.questions);
  if (test.questions) {
      if (Array.isArray(test.questions)) console.log("QUESTIONS LENGTH:", test.questions.length);
      else console.log("QUESTIONS KEYS:", Object.keys(test.questions));
  }
  console.log("TEST HAS TEST_INTERFACE_DATA:", !!test.test_interface_data);
  console.log("TEST CONFIG:", typeof test.config, test.config ? Object.keys(test.config) : 'null');
  
  console.log("ATTEMPTS:", test.testAttempts.length);
  for (const a of test.testAttempts) {
     console.log(" ATTEMPT:", a.id, "STATUS:", a.status);
  }
}

main().then(() => prisma.$disconnect()).catch(console.error);
