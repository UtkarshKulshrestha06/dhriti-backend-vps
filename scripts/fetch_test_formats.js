const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
    try {
        const legacyTests = await prisma.tests.findMany({
            where: {
                name: {
                    contains: 'DFST'
                }
            }
        });

        console.log(`Found ${legacyTests.length} legacy tests.`);
        
        // Find a recent test to see the new format
        const newTests = await prisma.tests.findMany({
            where: {
                name: {
                    not: {
                        contains: 'DFST'
                    }
                }
            },
            take: 2,
            orderBy: {
                created_at: 'desc'
            }
        });

        fs.writeFileSync('test_format_analysis.json', JSON.stringify({
            legacyTests: legacyTests.slice(0, 2),
            newTests: newTests
        }, null, 2));

        console.log('Saved to test_format_analysis.json');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
