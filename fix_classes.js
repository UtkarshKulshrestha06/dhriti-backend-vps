const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const batches = await prisma.batches.findMany();
  for (const batch of batches) {
    let newDescription = batch.description;
    let newClassName = batch.class_name;
    
    // If description looks like "For Class 11th" or "For Class 12th Passed"
    if (batch.description && batch.description.toLowerCase().includes('for class')) {
        // Extract the class part
        const match = batch.description.match(/For Class (.*)/i);
        if (match) {
            newClassName = match[1].trim(); // e.g. "11th" or "12th"
        }
        
        // Update the description to the nice default
        newDescription = "Designed for students who are serious about their goals. This comprehensive program covers everything from foundational concepts to advanced problem-solving techniques.";
    }

    // If description is empty or very short, let's also give it the nice text
    if (!newDescription || newDescription.length < 10) {
         newDescription = "Designed for students who are serious about their goals. This comprehensive program covers everything from foundational concepts to advanced problem-solving techniques.";
    }
    
    await prisma.batches.update({
      where: { id: batch.id },
      data: {
        description: newDescription,
        class_name: newClassName
      }
    });
    console.log(`Updated batch ${batch.id}: className='${newClassName}'`);
  }
}

main()
  .then(() => console.log('Done fixing DB'))
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
