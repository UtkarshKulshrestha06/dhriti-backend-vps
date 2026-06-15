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

        console.log(`Found ${legacyTests.length} tests matching DFST.`);
        
        let convertedCount = 0;

        for (const test of legacyTests) {
            // Check if it's in legacy format (questions is an array)
            if (!test.questions || !Array.isArray(test.questions)) {
                console.log(`Skipping test ${test.id} - ${test.name} as it does not appear to be in legacy format.`);
                continue;
            }

            console.log(`Converting test ${test.id} - ${test.name}`);

            const oldQuestions = test.questions;
            const oldConfig = test.config || {};
            const oldSections = oldConfig.sections || [];

            const newQuestions = {};
            const newAnswerKey = {};

            // Helper to get standard section name
            const getSectionName = (oldName) => {
                if (oldName.toLowerCase().includes('single option')) return 'Section A';
                if (oldName.toLowerCase().includes('numerical')) return 'Section B';
                if (oldName.toLowerCase().includes('section 2')) return 'Section B'; // assuming JEE standard
                if (oldName.toLowerCase().includes('section 3')) return 'Section C';
                return oldName;
            };

            for (const section of oldSections) {
                const subject = section.subject;
                const sectionName = getSectionName(section.name);

                if (!newQuestions[subject]) {
                    newQuestions[subject] = {};
                    newAnswerKey[subject] = {};
                }
                if (!newQuestions[subject][sectionName]) {
                    newQuestions[subject][sectionName] = {};
                    newAnswerKey[subject][sectionName] = {};
                }

                let secQueId = 1;
                for (const qIdx of section.questionIndices) {
                    const q = oldQuestions[qIdx];
                    if (!q) continue;

                    const queId = q.id;
                    const type = q.type === 'MCQ' ? 'mcq' : 'nat';
                    const answerOptions = type === 'mcq' ? "4" : "";

                    // Marks mapping (defaulting to +4/-1 for all, as typical for JEE)
                    // You might want to adjust NAT negative marking if it differs.
                    const marks = { cm: 4, im: -1, max: 4 };

                    newQuestions[subject][sectionName][queId] = {
                        secQueId: secQueId,
                        queId: queId,
                        type: type,
                        answerOptions: answerOptions,
                        marks: marks,
                        imageUrls: q.imageUrls || [],
                        // legacy didn't have pdfData, but we can add an empty object to prevent errors if frontend expects it
                        pdfData: {} 
                    };

                    let correctAnswer;
                    if (type === 'mcq') {
                        // Legacy correctOption was 0-indexed (0=A, 1=B, etc.)
                        // New correctAnswer is 1-indexed (1=A, 2=B, etc.)
                        if (q.correctOption !== undefined && q.correctOption !== null) {
                            correctAnswer = parseInt(q.correctOption) + 1;
                        } else {
                            correctAnswer = "BONUS";
                        }
                    } else {
                        // NAT
                        correctAnswer = q.correctValue || "";
                    }

                    newAnswerKey[subject][sectionName][queId] = {
                        type: type,
                        answerOptions: answerOptions,
                        correctAnswer: correctAnswer
                    };

                    secQueId++;
                }
            }

            // Construct new config
            const newConfig = {
                ...oldConfig,
                sections: [], // Clear out legacy sections array as it's meant for pdf crop data in new format
                legacyMeta: {
                    migrated: true,
                    originalSections: oldSections // Keep just in case
                }
            };

            // Calculate test question count if not present
            const question_count = oldQuestions.length;

            // Update in DB
            await prisma.tests.update({
                where: { id: test.id },
                data: {
                    questions: newQuestions,
                    answer_key: newAnswerKey,
                    config: newConfig,
                    question_count: test.question_count || question_count
                }
            });

            convertedCount++;
            console.log(`Successfully converted and updated test ${test.id}`);
        }

        console.log(`Migration complete. Converted ${convertedCount} tests.`);

    } catch (e) {
        console.error("Error during migration:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
