const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { requireAuth, requireAdmin, requireTeacher } = require("../middleware/auth");
const { calculatePdf2CbtScore } = require("../services/pdf2cbtEngine");

const prisma = new PrismaClient();

function isPdf2CbtV2Payload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const config = payload.config && typeof payload.config === 'object' ? payload.config : payload;
    return config.schemaVersion === 2 && config.engine === 'pdf2cbt';
}

function getProvidedAnswerKey(payload) {
    return payload.answer_key ?? payload.answerKey ?? payload.testAnswerKey ?? payload.answerKeyData;
}

function getProvidedTestData(payload) {
    return payload.questions ?? payload.testInterfaceData ?? payload.testData;
}

function getDurationMinutes(payload, config) {
    return payload.duration_minutes
        || payload.durationMinutes
        || config?.testConfig?.durationMinutes
        || config?.durationMinutes
        || 180;
}

function normalizeV2Config(payload) {
    const incomingConfig = payload.config && typeof payload.config === 'object' ? payload.config : {};
    if (!isPdf2CbtV2Payload(payload)) return incomingConfig;

    return {
        ...incomingConfig,
        schemaVersion: 2,
        engine: 'pdf2cbt',
        testConfig: incomingConfig.testConfig || payload.testConfig || {
            name: payload.name || payload.title || "Untitled Test",
            durationMinutes: payload.duration_minutes || payload.durationMinutes || 180,
            pattern: payload.patternType || payload.pattern || "CUSTOM",
            subjects: [],
            sections: []
        },
        pdfCropperData: incomingConfig.pdfCropperData ?? payload.pdfCropperData,
        source: incomingConfig.source ?? payload.source,
        solutions: incomingConfig.solutions ?? payload.solutions,
        legacyMeta: incomingConfig.legacyMeta ?? payload.legacyMeta
    };
}

function buildPdf2CbtResultPayload(result) {
    return {
        counts: {
            correct: result.correct,
            incorrect: result.incorrect,
            partial: result.partial,
            unanswered: result.unanswered,
            bonus: result.bonus,
            dropped: result.dropped
        },
        sectionScores: result.sectionScores,
        questionResults: result.questionResults,
        totalQuestions: result.totalQuestions
    };
}

const MAX_V2_TEST_PAYLOAD_BYTES = 28 * 1024 * 1024;
const MAX_V2_QUESTION_COUNT = 400;

function estimateJsonSizeBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value || {}), "utf8");
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function countPdf2CbtQuestions(testData) {
    if (!testData || typeof testData !== "object") return 0;
    return Object.values(testData).reduce((subjectTotal, subjectData) => {
        if (!subjectData || typeof subjectData !== "object") return subjectTotal;
        return subjectTotal + Object.values(subjectData).reduce((sectionTotal, sectionData) => {
            if (!sectionData || typeof sectionData !== "object") return sectionTotal;
            return sectionTotal + Object.keys(sectionData).length;
        }, 0);
    }, 0);
}

function validatePdf2CbtPayload({ name, config, testData, answerKey, durationMinutes, payload }) {
    const errors = [];
    const questionCount = countPdf2CbtQuestions(testData);
    const payloadSize = estimateJsonSizeBytes(payload);

    if (!name || !`${name}`.trim()) {
        errors.push("Test name is required.");
    }

    if (!config || config.schemaVersion !== 2 || config.engine !== "pdf2cbt") {
        errors.push("Invalid PDF2CBT config metadata.");
    }

    if (!testData || typeof testData !== "object" || questionCount === 0) {
        errors.push("PDF2CBT test data must contain at least one question.");
    }

    if (!answerKey || typeof answerKey !== "object") {
        errors.push("PDF2CBT answer key payload is invalid.");
    }

    if (!Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) <= 0 || Number(durationMinutes) > 720) {
        errors.push("Duration minutes must be between 1 and 720.");
    }

    if (questionCount > MAX_V2_QUESTION_COUNT) {
        errors.push(`PDF2CBT test exceeds the supported question limit of ${MAX_V2_QUESTION_COUNT}.`);
    }

    if (payloadSize > MAX_V2_TEST_PAYLOAD_BYTES) {
        errors.push("PDF2CBT payload is too large. Reduce embedded images or split the test.");
    }

    if (testData && answerKey && typeof testData === "object" && typeof answerKey === "object") {
        for (const [subject, subjectData] of Object.entries(testData)) {
            for (const [section, sectionData] of Object.entries(subjectData || {})) {
                for (const [questionKey, questionData] of Object.entries(sectionData || {})) {
                    const keyData = answerKey?.[subject]?.[section]?.[questionKey];
                    const type = questionData?.type || keyData?.type;
                    if (!type) {
                        errors.push(`Missing question type for ${subject} / ${section} / ${questionKey}.`);
                    }

                    if (!questionData?.marks || !Number.isFinite(Number(questionData.marks.cm)) || !Number.isFinite(Number(questionData.marks.im))) {
                        errors.push(`Invalid marks for ${subject} / ${section} / ${questionKey}.`);
                    }

                    const imageUrls = questionData?.pdfData?.imageUrls;
                    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
                        errors.push(`Missing question image for ${subject} / ${section} / ${questionKey}.`);
                    }

                    if (keyData && keyData.type && keyData.type !== type) {
                        errors.push(`Answer key type mismatch for ${subject} / ${section} / ${questionKey}.`);
                    }
                }
            }
        }
    }

    return [...new Set(errors)];
}

/**
 * Helper: Extract answer key from questions array
 */
function extractAnswerKey(questions) {
    const answerKey = {};
    (questions || []).forEach((q, idx) => {
        if (q.type === 'NUMERICAL' && q.correctValue !== undefined && q.correctValue !== '') {
            answerKey[idx] = { type: 'NUMERICAL', correct: q.correctValue, isBonus: q.isBonus || false };
        } else if (q.type === 'MULTIPLE_MCQ' && q.correctOptions && q.correctOptions.length > 0) {
            answerKey[idx] = { type: 'MULTIPLE_MCQ', correct: q.correctOptions, isBonus: q.isBonus || false };
        } else if (q.type === 'MCQ' && q.correctOption !== undefined && q.correctOption >= 0) {
            answerKey[idx] = { type: 'MCQ', correct: q.correctOption, isBonus: q.isBonus || false };
        }
    });
    return answerKey;
}

/**
 * Helper: Recalculate score for an attempt based on new answer key
 * Uses JEE Advanced marking: +4 correct, -1 wrong, 0 unanswered, bonus = full marks
 */
function recalculateScore(answers, answerKey, config, questions) {
    let score = 0;
    let maxScore = 0;
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    const subjectScores = {};

    // Build a map of questionIndex -> markingScheme (for ALL patterns with sections)
    const qSchemeMap = {};
    if (config?.sections) {
        config.sections.forEach(sec => {
            if (sec.markingScheme && sec.questionIndices) {
                sec.questionIndices.forEach(qIdx => {
                    qSchemeMap[qIdx] = sec.markingScheme;
                });
            }
        });
    }

    Object.keys(answerKey).forEach(qIdxStr => {
        const qIdx = parseInt(qIdxStr, 10);
        const key = answerKey[qIdxStr];
        const studentAnswer = answers[qIdxStr];

        // Subject tracking
        const subject = (questions && questions[qIdx]?.subject) || 'General';
        if (subjectScores[subject] === undefined) subjectScores[subject] = 0;

        // Determine Marking Scheme for this question
        let cMarks = Number(config?.correctMarks || 4);
        let iMarks = Number(config?.incorrectMarks || -1);
        let uMarks = 0;

        if (qSchemeMap[qIdx]) {
            cMarks = Number(qSchemeMap[qIdx].correctMarks ?? cMarks);
            iMarks = Number(qSchemeMap[qIdx].incorrectMarks ?? iMarks);
            uMarks = Number(qSchemeMap[qIdx].unansweredMarks ?? uMarks);
        }

        // Ensure iMarks is always negative
        if (iMarks > 0) iMarks = -iMarks;

        maxScore += cMarks;

        if (key.isBonus) {
            score += cMarks;
            subjectScores[subject] += cMarks;
            correct++;
            return;
        }

        if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '' || studentAnswer === -1 || (Array.isArray(studentAnswer) && studentAnswer.length === 0)) {
            score += uMarks;
            subjectScores[subject] += uMarks;
            unanswered++;
            return;
        }

        let isCorrect = false;
        let isIncorrect = false;
        let isPartial = false;
        let earnedPartial = 0;

        if (key.type === 'NUMERICAL') {
            const studentNum = parseFloat(studentAnswer);
            const correctNum = parseFloat(key.correct);
            isCorrect = !isNaN(studentNum) && !isNaN(correctNum) && Math.abs(studentNum - correctNum) < 0.01;
        } else if (key.type === 'MULTIPLE_MCQ') {
            const studentArr = Array.isArray(studentAnswer) ? [...studentAnswer].sort() : [Number(studentAnswer)].sort();
            const correctArr = Array.isArray(key.correct) ? [...key.correct].sort() : [];

            isCorrect = studentArr.length === correctArr.length && studentArr.every((val, i) => val === correctArr[i]);

            if (!isCorrect) {
                const hasWrongOption = studentArr.some(val => !correctArr.includes(val));
                if (hasWrongOption) {
                    isIncorrect = true;
                } else if (studentArr.length > 0) {
                    // JEE Advanced MSQ Partial Marking: +marks for number of correct options chosen, NO wrong options
                    isPartial = true;
                    earnedPartial = studentArr.length;
                }
            }
        } else {
            isCorrect = studentAnswer === key.correct;
        }

        if (isCorrect) {
            score += cMarks;
            subjectScores[subject] += cMarks;
            correct++;
        } else if (isPartial) {
            score += earnedPartial;
            subjectScores[subject] += earnedPartial;
            correct++;
        } else {
            score += iMarks;
            subjectScores[subject] += iMarks;
            incorrect++;
        }
    });

    const accuracy = maxScore > 0 ? ((correct / Object.keys(answerKey).length) * 100).toFixed(2) : 0;
    return { score, maxScore, accuracy: parseFloat(accuracy), correct, incorrect, unanswered, subjectScores };
}

/**
 * Helper: Recalculate all attempts for a test
 */
async function recalculateAllAttempts(testId, answerKey, config, questions) {
    const attempts = await prisma.testAttempts.findMany({
        where: { test_id: testId },
        select: { id: true, answers: true }
    });

    if (!attempts || attempts.length === 0) return { updated: 0 };

    let updated = 0;
    for (const attempt of attempts) {
        const { score, maxScore, accuracy, subjectScores } = recalculateScore(attempt.answers || {}, answerKey, config, questions);
        
        try {
            await prisma.testAttempts.update({
                where: { id: attempt.id },
                data: { score, max_score: maxScore, accuracy, subject_scores: subjectScores }
            });
            updated++;
        } catch (updateError) {
            console.error(`Failed to update attempt ${attempt.id}:`, updateError);
        }
    }
    return { updated };
}

async function recalculateAllPdf2CbtAttempts(testId, answerKey, testData) {
    const attempts = await prisma.testAttempts.findMany({
        where: { test_id: testId },
        select: { id: true, answers: true, status: true, time_spent: true }
    });

    if (!attempts || attempts.length === 0) return { updated: 0 };

    let updated = 0;
    for (const attempt of attempts) {
        const result = calculatePdf2CbtScore({
            testData: testData || {},
            answerKey: answerKey || {},
            answers: attempt.answers || {},
            status: attempt.status || {},
            timeSpent: attempt.time_spent || {}
        });

        try {
            await prisma.testAttempts.update({
                where: { id: attempt.id },
                data: {
                    score: result.score,
                    max_score: result.maxScore,
                    accuracy: result.accuracy,
                    subject_scores: result.subjectScores,
                    status: {
                        ...(attempt.status || {}),
                        pdf2cbtResult: buildPdf2CbtResultPayload(result)
                    }
                }
            });
            updated++;
        } catch (updateError) {
            console.error(`Failed to update PDF2CBT attempt ${attempt.id}:`, updateError);
        }
    }
    return { updated };
}

/**
 * GET /tests/free
 * Get all free tests (accessible by any authenticated user)
 */
router.get("/free", requireAuth, async (req, res) => {
    try {
        const data = await prisma.tests.findMany({
            where: { is_free: true },
            orderBy: { created_at: 'desc' }
        });

        res.json(data || []);
    } catch (err) {
        console.error("GET FREE TESTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch free tests" });
    }
});

/**
 * GET /tests
 * Get tests for a batch (supports is_free filter)
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId, is_free } = req.query;
    const targetBatchId = batch || batchId;

    try {
        const whereClause = {};

        if (targetBatchId) {
            whereClause.batch_id = targetBatchId;
        }

        // Support is_free filter
        if (is_free === 'true') {
            whereClause.is_free = true;
        } else if (is_free === 'false') {
            whereClause.is_free = false;
        }

        // Support meta_only filter
        const selectClause = req.query.meta_only === 'true'
            ? {
                id: true, name: true, created_at: true, batch_id: true,
                is_free: true, schedule: true, config: true, duration_minutes: true,
                test_type: true, tags: true
            }
            : undefined;

        const data = await prisma.tests.findMany({
            where: whereClause,
            select: selectClause,
            orderBy: { created_at: 'desc' }
        });

        res.json(data || []);
    } catch (err) {
        console.error("GET TESTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch tests" });
    }
});

/**
 * GET /tests/attempts/me
 * Get all attempts for current student
 */
router.get("/attempts/me", requireAuth, async (req, res) => {
    try {
        const data = await prisma.testAttempts.findMany({
            where: { student_id: req.user.id },
            orderBy: { created_at: 'desc' }
        });

        // Transform to frontend format
        const attempts = (data || []).map(a => ({
            id: a.id,
            testId: a.test_id,
            studentId: a.student_id,
            studentName: a.student_name,
            score: a.score ? Number(a.score) : 0,
            maxScore: a.max_score ? Number(a.max_score) : 0,
            accuracy: a.accuracy ? Number(a.accuracy) : 0,
            timeTaken: a.time_taken,
            answers: a.answers || {},
            status: a.status || {},
            timeSpent: a.time_spent || {},
            questionKeys: a.question_keys || {},
            subjectScores: a.subject_scores || {},
            result: a.status?.pdf2cbtResult,
            isSubmitted: a.is_submitted !== false,
            timestamp: new Date(a.created_at).getTime()
        }));

        res.json(attempts);
    } catch (err) {
        console.error("GET MY ATTEMPTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch attempts" });
    }
});

/**
 * GET /tests/:id
 * Get single test
 */
router.get("/:id", requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const data = await prisma.tests.findUnique({
            where: { id }
        });

        if (!data) {
            return res.status(404).json({ error: "Test not found" });
        }

        res.json(data);
    } catch (err) {
        console.error("GET TEST ERROR:", err);
        res.status(500).json({ error: "Failed to fetch test" });
    }
});

/**
 * GET /tests/:id/export
 * Export test as JSON
 */
router.get("/:id/export", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        const test = await prisma.tests.findUnique({
            where: { id }
        });

        if (!test) {
            return res.status(404).json({ error: "Test not found" });
        }

        // Create export package
        const exportData = {
            version: "1.0",
            exportedAt: new Date().toISOString(),
            test: {
                name: test.name,
                config: test.config || {},
                schedule: test.schedule || {},
                questions: test.questions || [],
                answer_key: test.answer_key || {},
                duration_minutes: test.duration_minutes || 180,
                tags: test.tags || [],
                is_free: test.is_free || false,
                test_type: test.test_type || 'FULL_SYLLABUS'
            }
        };

        res.json(exportData);
    } catch (err) {
        console.error("EXPORT TEST ERROR:", err);
        res.status(500).json({ error: "Failed to export test" });
    }
});

/**
 * POST /tests
 * Teacher+: Create test
 */
router.post("/", requireAuth, requireTeacher, async (req, res) => {
    const {
        batch_id,
        batchId,
        name,
        title,
        config,
        schedule,
        questions,
        answer_key,
        answerKey,
        duration_minutes,
        durationMinutes,
        tags,
        test_type
    } = req.body;

    const finalBatchId = batch_id || batchId;
    const finalName = name || title;

    if (!finalBatchId || !finalName) {
        return res.status(400).json({ error: "batch_id and name are required" });
    }

    try {
        const isV2Test = isPdf2CbtV2Payload(req.body);
        const finalConfig = isV2Test ? normalizeV2Config(req.body) : (config || {});
        const finalQuestions = isV2Test ? (getProvidedTestData(req.body) || {}) : (questions || []);
        const providedAnswerKey = answer_key ?? answerKey ?? getProvidedAnswerKey(req.body);
        const finalAnswerKey = isV2Test
            ? (providedAnswerKey || {})
            : extractAnswerKey(questions);
        const isFree = finalBatchId === 'free-tests';

        if (isV2Test) {
            const validationErrors = validatePdf2CbtPayload({
                name: finalName,
                config: finalConfig,
                testData: finalQuestions,
                answerKey: finalAnswerKey,
                durationMinutes: getDurationMinutes(req.body, finalConfig),
                payload: req.body
            });

            if (validationErrors.length > 0) {
                return res.status(400).json({ error: validationErrors[0], details: validationErrors });
            }
        }

        const insertData = {
            batch_id: isFree ? null : finalBatchId,
            name: finalName,
            config: finalConfig,
            schedule: schedule || {},
            questions: finalQuestions,
            answer_key: finalAnswerKey,
            duration_minutes: getDurationMinutes(req.body, finalConfig),
            tags: tags || [],
            created_by: req.user.id,
            is_free: isFree,
            test_type: test_type || 'FULL_SYLLABUS'
        };

        const data = await prisma.tests.create({
            data: insertData
        });

        res.json(data);
    } catch (err) {
        console.error("CREATE TEST ERROR:", err);
        res.status(500).json({ error: "Failed to create test" });
    }
});

/**
 * POST /tests/import
 * Teacher+: Import test from JSON
 */
router.post("/import", requireAuth, requireTeacher, async (req, res) => {
    const { batch_id, batchId, testData } = req.body;
    const finalBatchId = batch_id || batchId;

    // Handle both new format (wrapped in .test) and legacy format (flat object)
    const importSource = testData?.test || testData;

    if (!finalBatchId || !importSource) {
        return res.status(400).json({ error: "batch_id and valid testData are required" });
    }

    try {
        const imported = importSource;
        const isFree = finalBatchId === 'free-tests';
        const isV2Test = isPdf2CbtV2Payload(imported);
        const finalConfig = isV2Test ? normalizeV2Config(imported) : (imported.config || {});
        const finalQuestions = isV2Test ? (getProvidedTestData(imported) || {}) : (imported.questions || []);

        // Compute answer_key from questions if not provided in import data
        const answerKey = isV2Test
            ? (getProvidedAnswerKey(imported) || {})
            : (imported.answer_key || extractAnswerKey(imported.questions || []));

        if (isV2Test) {
            const validationErrors = validatePdf2CbtPayload({
                name: imported.name || "Imported Test",
                config: finalConfig,
                testData: finalQuestions,
                answerKey,
                durationMinutes: getDurationMinutes(imported, finalConfig),
                payload: imported
            });

            if (validationErrors.length > 0) {
                return res.status(400).json({ error: validationErrors[0], details: validationErrors });
            }
        }

        const insertData = {
            batch_id: isFree ? null : finalBatchId,
            name: imported.name || "Imported Test",
            config: finalConfig,
            schedule: imported.schedule || {},
            questions: finalQuestions,
            answer_key: answerKey,
            duration_minutes: getDurationMinutes(imported, finalConfig),
            tags: imported.tags || [],
            created_by: req.user.id,
            is_free: isFree,
            test_type: imported.test_type || 'FULL_SYLLABUS'
        };

        const data = await prisma.tests.create({
            data: insertData
        });

        res.json(data);
    } catch (err) {
        console.error("IMPORT TEST ERROR:", err);
        res.status(500).json({ error: "Failed to import test" });
    }
});

/**
 * GET /tests/:id/leaderboard
 * Get leaderboard for a test (ranked by score, then time taken)
 */
router.get("/:id/leaderboard", requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const data = await prisma.testAttempts.findMany({
            where: { test_id: id },
            orderBy: [
                { score: 'desc' },
                { time_taken: 'asc' }
            ]
        });

        // Filter out unsubmitted attempts and add rank
        const submittedAttempts = (data || []).filter(a => {
            if (a.is_submitted === false) return false;
            if (a.status && a.status.is_submitted === false) return false;
            return true;
        });

        const leaderboard = submittedAttempts.map((a, idx) => ({
            rank: idx + 1,
            id: a.id,
            studentId: a.student_id,
            studentName: a.student_name || 'Anonymous',
            score: a.score ? Number(a.score) : 0,
            maxScore: a.max_score ? Number(a.max_score) : 0,
            accuracy: a.accuracy ? Number(a.accuracy) : 0,
            timeTaken: a.time_taken || 0,
            subjectScores: a.subject_scores || {},
            result: a.status?.pdf2cbtResult,
            timestamp: new Date(a.created_at).getTime()
        }));

        res.json(leaderboard);
    } catch (err) {
        console.error("GET LEADERBOARD ERROR:", err);
        res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
});


/**
 * POST /tests/:id/attempts
 * Student: Submit test attempt / Auto-save
 */
router.post("/:id/attempts", requireAuth, async (req, res) => {
    const { id } = req.params;
    const {
        score,
        maxScore,
        max_score,
        accuracy,
        timeTaken,
        time_taken,
        answers,
        status,
        timeSpent,
        time_spent,
        questionKeys,
        question_keys,
        subjectScores,
        subject_scores,
        isSubmitted
    } = req.body;

    const finalIsSubmitted = isSubmitted !== false; // defaults to true if undefined

    try {
        const testData = await prisma.tests.findUnique({
            where: { id },
            select: { config: true, answer_key: true, questions: true }
        });

        if (!testData) {
            return res.status(404).json({ error: "Test not found" });
        }

        const isV2Test = isPdf2CbtV2Payload(testData);

        // Get student name
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { first_name: true, last_name: true }
        });

        const studentName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student';

        // Check if an unsubmitted attempt already exists (use dedicated column)
        const existingAttempts = await prisma.testAttempts.findMany({
            where: {
                test_id: id,
                student_id: req.user.id,
                is_submitted: false
            },
            select: { id: true },
            orderBy: { created_at: 'desc' },
            take: 1
        });

        const unsubmittedAttempt = existingAttempts?.[0] || null;

        const statusObj = status || {};
        statusObj.is_submitted = finalIsSubmitted;
        const timeSpentObj = timeSpent || time_spent || {};
        let finalScore = score || 0;
        let finalMaxScore = maxScore || max_score || 0;
        let finalAccuracy = accuracy || 0;
        let finalSubjectScores = subjectScores || subject_scores || {};

        if (isV2Test) {
            const result = calculatePdf2CbtScore({
                testData: testData.questions || {},
                answerKey: testData.answer_key || {},
                answers: answers || {},
                status: status || {},
                timeSpent: timeSpentObj
            });

            finalScore = result.score;
            finalMaxScore = result.maxScore;
            finalAccuracy = result.accuracy;
            finalSubjectScores = result.subjectScores;
            statusObj.pdf2cbtResult = buildPdf2CbtResultPayload(result);
        }

        const payload = {
            test_id: id,
            student_id: req.user.id,
            student_name: studentName,
            score: finalScore,
            max_score: finalMaxScore,
            accuracy: finalAccuracy,
            time_taken: timeTaken || time_taken || 0,
            answers: answers || {},
            status: statusObj,
            time_spent: timeSpentObj,
            question_keys: questionKeys || question_keys || {},
            subject_scores: finalSubjectScores,
            is_submitted: finalIsSubmitted
        };

        let data;
        if (unsubmittedAttempt) {
            // Update the existing unsubmitted attempt
            data = await prisma.testAttempts.update({
                where: { id: unsubmittedAttempt.id },
                data: payload
            });
        } else {
            // Insert new attempt
            data = await prisma.testAttempts.create({
                data: payload
            });
        }

        res.json({
            id: data.id,
            testId: data.test_id,
            studentId: data.student_id,
            studentName: data.student_name,
            score: data.score ? Number(data.score) : 0,
            maxScore: data.max_score ? Number(data.max_score) : 0,
            accuracy: data.accuracy ? Number(data.accuracy) : 0,
            timeTaken: data.time_taken,
            answers: data.answers || {},
            status: data.status || {},
            timeSpent: data.time_spent || {},
            questionKeys: data.question_keys || {},
            subjectScores: data.subject_scores || {},
            result: data.status?.pdf2cbtResult,
            isSubmitted: data.is_submitted !== false,
            timestamp: new Date(data.created_at).getTime()
        });
    } catch (err) {
        console.error("SUBMIT ATTEMPT ERROR:", err);
        res.status(500).json({ error: "Failed to submit attempt" });
    }
});

/**
 * POST /tests/:id/attempts/:attemptId/recalculate
 * Manually recalculate a specific attempt's score (Fixing corrupted old leaderboards)
 */
router.post("/:id/attempts/:attemptId/recalculate", requireAuth, async (req, res) => {
    const { id, attemptId } = req.params;

    try {
        // Fetch the test config, answer key, AND questions (needed for subject scores)
        const testData = await prisma.tests.findUnique({
            where: { id },
            select: { config: true, answer_key: true, questions: true }
        });

        if (!testData) {
            return res.status(404).json({ error: "Test not found" });
        }

        // Fetch the specific attempt
        const attempt = await prisma.testAttempts.findUnique({
            where: { id: attemptId },
            select: { id: true, student_id: true, answers: true, status: true, time_spent: true }
        });

        if (!attempt) {
            return res.status(404).json({ error: "Attempt not found" });
        }

        // Ensure the caller is either the student who took it, or an admin/teacher
        if (attempt.student_id !== req.user.id && req.user.role === 'STUDENT') {
            return res.status(403).json({ error: "Not authorized to recalculate this attempt" });
        }

        const isV2Test = isPdf2CbtV2Payload(testData);
        let resultPayload;
        let score;
        let maxScore;
        let accuracy;
        let subjectScores;

        if (isV2Test) {
            const result = calculatePdf2CbtScore({
                testData: testData.questions || {},
                answerKey: testData.answer_key || {},
                answers: attempt.answers || {},
                status: attempt.status || {},
                timeSpent: attempt.time_spent || {}
            });
            score = result.score;
            maxScore = result.maxScore;
            accuracy = result.accuracy;
            subjectScores = result.subjectScores;
            resultPayload = buildPdf2CbtResultPayload(result);
        } else {
            // Calculate the correct score using backend's fixed grading algorithm (with subject scores)
            const legacyResult = recalculateScore(
                attempt.answers || {},
                testData.answer_key || {},
                testData.config || {},
                testData.questions || []
            );
            score = legacyResult.score;
            maxScore = legacyResult.maxScore;
            accuracy = legacyResult.accuracy;
            subjectScores = legacyResult.subjectScores;
        }

        // Update the attempt in the database (including subject_scores)
        const updateData = { score, max_score: maxScore, accuracy, subject_scores: subjectScores };
        if (resultPayload) {
            updateData.status = {
                ...(attempt.status || {}),
                pdf2cbtResult: resultPayload,
                is_submitted: attempt.status?.is_submitted !== false
            };
        }

        const updatedAttempt = await prisma.testAttempts.update({
            where: { id: attemptId },
            data: updateData
        });

        res.json({
            id: updatedAttempt.id,
            score: updatedAttempt.score ? Number(updatedAttempt.score) : 0,
            maxScore: updatedAttempt.max_score ? Number(updatedAttempt.max_score) : 0,
            accuracy: updatedAttempt.accuracy ? Number(updatedAttempt.accuracy) : 0,
            subjectScores: updatedAttempt.subject_scores || {},
            result: updatedAttempt.status?.pdf2cbtResult
        });

    } catch (err) {
        console.error("RECALCULATE ATTEMPT ERROR:", err);
        res.status(500).json({ error: "Failed to recalculate attempt" });
    }
});

/**
 * PUT /tests/:id
 * Teacher+: Update test (allows teachers to edit answer keys or rename)
 */
router.put("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        const updateData = {};
        const isV2Test = isPdf2CbtV2Payload(req.body);
        let existingV2Test = null;
        if (req.body.name !== undefined) updateData.name = req.body.name;
        if (req.body.config !== undefined || isV2Test) updateData.config = isV2Test ? normalizeV2Config(req.body) : req.body.config;
        if (req.body.schedule !== undefined) updateData.schedule = req.body.schedule;
        if (req.body.tags !== undefined) updateData.tags = req.body.tags;
        if (req.body.test_type !== undefined) updateData.test_type = req.body.test_type;
        if (req.body.duration_minutes !== undefined || req.body.durationMinutes !== undefined)
            updateData.duration_minutes = req.body.duration_minutes || req.body.durationMinutes;

        // Handle answer key extraction and score recalculation ONLY if questions are provided
        let attemptsRecalculated = 0;
        const providedQuestions = getProvidedTestData(req.body);
        if (providedQuestions !== undefined) {
            updateData.questions = providedQuestions;

            if (isV2Test) {
                const providedAnswerKey = getProvidedAnswerKey(req.body);
                if (providedAnswerKey !== undefined) {
                    updateData.answer_key = providedAnswerKey;
                }

                if (updateData.answer_key === undefined) {
                    existingV2Test = existingV2Test || await prisma.tests.findUnique({
                        where: { id },
                        select: { answer_key: true, questions: true }
                    });
                    updateData.answer_key = existingV2Test?.answer_key || {};
                }

                const result = await recalculateAllPdf2CbtAttempts(id, updateData.answer_key, providedQuestions);
                attemptsRecalculated = result.updated;
            } else {
                const newAnswerKey = extractAnswerKey(providedQuestions);
                updateData.answer_key = newAnswerKey;

                // Recalculate scores for existing attempts
                const result = await recalculateAllAttempts(id, newAnswerKey, req.body.config, providedQuestions);
                attemptsRecalculated = result.updated;
            }
        } else if (isV2Test) {
            const providedAnswerKey = getProvidedAnswerKey(req.body);
            if (providedAnswerKey !== undefined) {
                updateData.answer_key = providedAnswerKey;

                existingV2Test = existingV2Test || await prisma.tests.findUnique({
                    where: { id },
                    select: { answer_key: true, questions: true }
                });
                const result = await recalculateAllPdf2CbtAttempts(id, providedAnswerKey, existingV2Test?.questions || {});
                attemptsRecalculated = result.updated;
            }
        }

        if (isV2Test) {
            const currentSnapshot = await prisma.tests.findUnique({
                where: { id },
                select: { name: true, questions: true, answer_key: true, config: true, duration_minutes: true }
            });

            const validationErrors = validatePdf2CbtPayload({
                name: updateData.name || currentSnapshot?.name,
                config: updateData.config || currentSnapshot?.config,
                testData: updateData.questions !== undefined ? updateData.questions : currentSnapshot?.questions,
                answerKey: updateData.answer_key !== undefined ? updateData.answer_key : currentSnapshot?.answer_key,
                durationMinutes: updateData.duration_minutes || currentSnapshot?.duration_minutes || 180,
                payload: {
                    ...req.body,
                    config: updateData.config || currentSnapshot?.config,
                    questions: updateData.questions !== undefined ? updateData.questions : currentSnapshot?.questions,
                    answer_key: updateData.answer_key !== undefined ? updateData.answer_key : currentSnapshot?.answer_key
                }
            });

            if (validationErrors.length > 0) {
                return res.status(400).json({ error: validationErrors[0], details: validationErrors });
            }
        }

        const data = await prisma.tests.update({
            where: { id },
            data: updateData
        });

        res.json({ ...data, attemptsRecalculated });
    } catch (err) {
        console.error("UPDATE TEST ERROR:", err);
        res.status(500).json({ error: "Failed to update test" });
    }
});

/**
 * DELETE /tests/:id
 * Admin only: Delete test
 */
router.delete("/:id", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;

    try {
        const existingTest = await prisma.tests.findUnique({
            where: { id },
            select: { id: true }
        });

        if (!existingTest) {
            return res.status(404).json({ error: "Test not found" });
        }

        await prisma.$transaction(async (tx) => {
            const bookmarks = await tx.bookmarks.findMany({
                where: { test_id: id },
                select: { id: true }
            });

            const bookmarkIds = bookmarks.map((bookmark) => bookmark.id);

            if (bookmarkIds.length > 0) {
                await tx.bookmarkTagRelations.deleteMany({
                    where: { bookmark_id: { in: bookmarkIds } }
                });
            }

            await tx.bookmarks.deleteMany({
                where: { test_id: id }
            });

            await tx.testAttempts.deleteMany({
                where: { test_id: id }
            });

            await tx.tests.delete({
                where: { id }
            });
        });

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE TEST ERROR:", err);
        res.status(500).json({ error: "Failed to delete test" });
    }
});

module.exports = router;
