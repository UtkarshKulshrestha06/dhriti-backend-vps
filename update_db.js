const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("Starting DB migration for resources...");
    
    // 1. Fetch all resources
    const resources = await prisma.resources.findMany({
        include: {
            batch: {
                include: { stream: true }
            }
        }
    });

    console.log(`Found ${resources.length} resources to process.`);

    for (const res of resources) {
        let streamName = 'General';
        
        if (res.batch_id === 'freebies') {
            // Infer from subject or title
            if (res.title.toLowerCase().includes('neet')) {
                streamName = 'NEET';
            } else if (res.title.toLowerCase().includes('foundation')) {
                streamName = 'Foundation';
            } else {
                streamName = 'JEE'; // Default
            }
        } else if (res.batch && res.batch.stream) {
            streamName = res.batch.stream.title;
        }

        await prisma.resources.update({
            where: { id: res.id },
            data: { stream: streamName }
        });
        
        console.log(`Updated resource ${res.id} (${res.title}) with stream: ${streamName}`);
    }

    console.log("Migration completed.");
}

main().catch(console.error).finally(async () => {
    await prisma.$disconnect();
});
