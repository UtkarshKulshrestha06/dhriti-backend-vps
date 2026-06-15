/**
 * One-off backfill: compute and store question_count for all existing tests.
 * Run once: node scripts/backfill-question-count.js
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

function isPdf2CbtV2(config) {
    return config && config.schemaVersion === 2 && config.engine === 'pdf2cbt';
}

function computeQuestionCount(test) {
    const config = test.config && typeof test.config === 'object' ? test.config : {};
    const isV2 = isPdf2CbtV2(config);

    if (isV2) {
        // pdfCropperData.boxes is the authoritative flat list
        const boxes = config.pdfCropperData?.boxes;
        if (Array.isArray(boxes) && boxes.length > 0) {
            return boxes.filter(b => b.kind === 'question').length;
        }
        // Traverse testInterfaceData (stored in questions column for v2)
        const testData = test.questions;
        if (!testData || typeof testData !== 'object') return 0;
        return Object.values(testData).reduce((s, subj) => {
            if (!subj || typeof subj !== 'object') return s;
            return s + Object.values(subj).reduce((t, sect) => {
                if (!sect || typeof sect !== 'object') return t;
                return t + Object.keys(sect).length;
            }, 0);
        }, 0);
    }

    // Legacy: config.sections[].questionIndices
    if (Array.isArray(config.sections) && config.sections.length > 0) {
        return config.sections.reduce((total, sec) =>
            total + (Array.isArray(sec.questionIndices) ? sec.questionIndices.length : 0), 0);
    }

    // Final fallback: questions array
    return Array.isArray(test.questions) ? test.questions.length : 0;
}

async function main() {
    console.log('Fetching all tests...');
    const tests = await prisma.tests.findMany({
        select: { id: true, config: true, questions: true }
    });
    console.log(`Found ${tests.length} tests. Computing counts...`);

    let updated = 0;
    let skipped = 0;
    for (const test of tests) {
        const count = computeQuestionCount(test);
        if (count > 0) {
            await prisma.tests.update({
                where: { id: test.id },
                data: { question_count: count }
            });
            updated++;
        } else {
            skipped++;
        }
        process.stdout.write(`\r${updated + skipped}/${tests.length} processed (${updated} updated, ${skipped} skipped)`);
    }

    console.log(`\nDone. ${updated} tests updated, ${skipped} with 0 questions skipped.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
