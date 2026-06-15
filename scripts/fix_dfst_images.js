const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const tests = await prisma.tests.findMany({
            where: {
                name: {
                    contains: 'DFST'
                }
            }
        });

        let updatedCount = 0;

        for (const test of tests) {
            // Check if migrated test
            if (test.config && test.config.legacyMeta && test.config.legacyMeta.migrated) {
                let modified = false;
                const newQuestions = JSON.parse(JSON.stringify(test.questions));
                const newAnswerKey = JSON.parse(JSON.stringify(test.answer_key));

                for (const subject of Object.keys(newQuestions)) {
                    for (const section of Object.keys(newQuestions[subject])) {
                        
                        let targetSection = section;

                        // Rename MCQ to Section A to match standard JEE format
                        if (section.toUpperCase() === 'MCQ') {
                            targetSection = 'Section A';
                            newQuestions[subject]['Section A'] = newQuestions[subject][section];
                            delete newQuestions[subject][section];

                            newAnswerKey[subject]['Section A'] = newAnswerKey[subject][section];
                            delete newAnswerKey[subject][section];
                            modified = true;
                        }

                        // Fix imageUrls placement
                        const sectionData = newQuestions[subject][targetSection];
                        for (const queId of Object.keys(sectionData)) {
                            const q = sectionData[queId];
                            
                            // Move imageUrls inside pdfData if not already
                            if (q.imageUrls && Array.isArray(q.imageUrls)) {
                                if (!q.pdfData) q.pdfData = {};
                                q.pdfData.imageUrls = q.imageUrls;
                                q.pdfData.solutionImageUrls = q.pdfData.solutionImageUrls || [];
                                delete q.imageUrls;
                                modified = true;
                            }
                        }
                    }
                }

                if (modified) {
                    await prisma.tests.update({
                        where: { id: test.id },
                        data: {
                            questions: newQuestions,
                            answer_key: newAnswerKey
                        }
                    });
                    updatedCount++;
                    console.log(`Fixed images and sections for test ${test.id} - ${test.name}`);
                }
            }
        }

        console.log(`Successfully fixed ${updatedCount} tests.`);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
