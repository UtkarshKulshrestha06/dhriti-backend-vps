const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const legacyTests = await prisma.tests.findMany({
            where: {
                name: {
                    contains: 'DFST'
                }
            }
        });

        let updatedCount = 0;

        for (const test of legacyTests) {
            // Check if it's our migrated test
            if (test.config && test.config.legacyMeta && test.config.legacyMeta.migrated) {
                const newConfig = {
                    ...test.config,
                    schemaVersion: 2,
                    engine: 'pdf2cbt'
                };

                await prisma.tests.update({
                    where: { id: test.id },
                    data: {
                        config: newConfig
                    }
                });
                updatedCount++;
                console.log(`Patched config for ${test.id}`);
            }
        }

        console.log(`Successfully patched ${updatedCount} migrated tests with schemaVersion: 2.`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
