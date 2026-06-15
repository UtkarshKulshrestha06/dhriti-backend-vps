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
        const test = await prisma.tests.findFirst({
            where: {
                name: 'JM DFST 03'
            }
        });

        fs.writeFileSync('dfst03_result.json', JSON.stringify(removeBase64(test), null, 2));

        console.log('Saved to dfst03_result.json');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
