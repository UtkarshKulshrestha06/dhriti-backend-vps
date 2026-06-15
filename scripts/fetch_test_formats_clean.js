const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

function removeBase64(obj) {
    if (typeof obj === 'string') {
        if (obj.startsWith('data:image')) {
            return 'BASE64_IMAGE_REMOVED';
        }
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(removeBase64);
    }
    if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = removeBase64(obj[key]);
        }
        return newObj;
    }
    return obj;
}

async function main() {
    try {
        const legacyTests = await prisma.tests.findMany({
            where: {
                name: {
                    contains: 'DFST'
                }
            },
            take: 1
        });

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

        fs.writeFileSync('test_format_analysis_clean.json', JSON.stringify({
            legacyTests: removeBase64(legacyTests),
            newTests: removeBase64(newTests)
        }, null, 2));

        console.log('Saved to test_format_analysis_clean.json');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
