const express = require("express");
const router = express.Router();
const { randomUUID } = require("crypto");
const prisma = require("../services/prisma");
const { requireAuth, requireAdmin, requireTeacher } = require("../middleware/auth");
const { calculatePdf2CbtScore } = require("../services/pdf2cbtEngine");


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
const FREE_TESTS_BATCH_ID = "free-tests";
const TEST_STATUS = {
    DRAFT: "DRAFT",
    PUBLISHED: "PUBLISHED",
    ARCHIVED: "ARCHIVED"
};
const ASSIGNMENT_STATUS = {
    ACTIVE: "ACTIVE",
    HIDDEN: "HIDDEN",
    ARCHIVED: "ARCHIVED"
};
const AUDIENCE_TYPE = {
    BATCH: "BATCH",
    FREE: "FREE"
};

function normalizeStatus(value, fallback = TEST_STATUS.DRAFT) {
    const normalized = `${value || fallback}`.toUpperCase();
    return Object.values(TEST_STATUS).includes(normalized) ? normalized : fallback;
}

function normalizeAssignmentStatus(value, fallback = ASSIGNMENT_STATUS.ACTIVE) {
    const normalized = `${value || fallback}`.toUpperCase();
    return Object.values(ASSIGNMENT_STATUS).includes(normalized) ? normalized : fallback;
}

function normalizeAudienceType(value, batchId) {
    const normalized = `${value || ""}`.toUpperCase();
    if (normalized === AUDIENCE_TYPE.FREE || batchId === FREE_TESTS_BATCH_ID) return AUDIENCE_TYPE.FREE;
    return AUDIENCE_TYPE.BATCH;
}

function jsonObject(value) {
    return value && typeof value === "object" ? value : {};
}

function formatAssignmentTest(test, assignment) {
    if (!assignment) return test;
    return {
        ...test,
        assignmentId: assignment.id,
        testAssignmentId: assignment.id,
        audienceType: assignment.audience_type,
        assignmentStatus: assignment.status,
        batch_id: assignment.audience_type === AUDIENCE_TYPE.FREE ? null : assignment.batch_id,
        is_free: assignment.audience_type === AUDIENCE_TYPE.FREE,
        schedule: jsonObject(assignment.schedule),
        allowReattempts: assignment.allow_reattempts !== false,
        leaderboardEnabled: assignment.leaderboard_enabled !== false,
        solutionsReleasePolicy: jsonObject(assignment.solutions_release_policy)
    };
}

function formatAttempt(a) {
    return {
        id: a.id,
        testId: a.test_id,
        testAssignmentId: a.test_assignment_id,
        assignmentId: a.test_assignment_id,
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
    };
}

async function ensureAssignment({ testId, batchId, audienceType, schedule, createdBy, status, allowReattempts, leaderboardEnabled, solutionsReleasePolicy }) {
    const finalAudienceType = normalizeAudienceType(audienceType, batchId);
    const finalBatchId = finalAudienceType === AUDIENCE_TYPE.FREE ? null : batchId;

    const existing = await prisma.testAssignments.findFirst({
        where: {
            test_id: testId,
            audience_type: finalAudienceType,
            batch_id: finalBatchId
        }
    });

    const data = {
        status: normalizeAssignmentStatus(status),
        schedule: schedule || {},
        allow_reattempts: allowReattempts !== false,
        leaderboard_enabled: leaderboardEnabled !== false,
        solutions_release_policy: solutionsReleasePolicy || {},
        created_by: createdBy
    };

    if (existing) {
        return prisma.testAssignments.update({
            where: { id: existing.id },
            data
        });
    }

    return prisma.testAssignments.create({
        data: {
            id: randomUUID(),
            test_id: testId,
            audience_type: finalAudienceType,
            batch_id: finalBatchId,
            ...data
        }
    });
}

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

/**
 * Compute question_count for a test payload.
 * PDF2CBT: traverse subject->section->question keys in testInterfaceData.
 * Legacy:  use config.sections[].questionIndices lengths (cheap), or fall back
 *          to questions array length.
 */
function computeQuestionCount(payload) {
    const isV2 = isPdf2CbtV2Payload(payload);

    if (isV2) {
        // pdfCropperData.boxes is the authoritative flat list in v2 tests
        const boxes = payload.config?.pdfCropperData?.boxes;
        if (Array.isArray(boxes) && boxes.length > 0) {
            return boxes.filter(b => b.kind === 'question').length;
        }
        // Fall back to traversing testInterfaceData/questions JSON
        const testData = payload.questions ?? payload.testInterfaceData ?? payload.testData;
        return countPdf2CbtQuestions(testData);
    }

    // Legacy tests: config.sections is always present and tiny
    const config = payload.config && typeof payload.config === 'object' ? payload.config : {};
    if (Array.isArray(config.sections) && config.sections.length > 0) {
        return config.sections.reduce((total, sec) => {
            return total + (Array.isArray(sec.questionIndices) ? sec.questionIndices.length : 0);
        }, 0);
    }

    // Final fallback: count the questions array directly
    const questions = payload.questions;
    return Array.isArray(questions) ? questions.length : 0;
}

function validatePdf2CbtPayload({ name, config, testData, answerKey, durationMinutes, payload }) {
    const errors = [];
    const questionCount = countPdf2CbtQuestions(testData);
    const payloadSize = estimateJsonSizeBytes(payload);
    const isDraft = (payload?.status === "DRAFT") || (payload?.status === "draft");

    if (!name || !`${name}`.trim()) {
        errors.push("Test name is required.");
    }

    if (!config || config.schemaVersion !== 2 || config.engine !== "pdf2cbt") {
        errors.push("Invalid PDF2CBT config metadata.");
    }

    if (!isDraft) {
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
    }

    if (payloadSize > MAX_V2_TEST_PAYLOAD_BYTES) {
        errors.push("PDF2CBT payload is too large. Reduce embedded images or split the test.");
    }

    if (!isDraft && testData && answerKey && typeof testData === "object" && typeof answerKey === "object") {
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
        const isMetaOnly = req.query.meta_only === 'true';
        const testSelect = isMetaOnly
            ? {
                id: true, name: true, created_at: true, batch_id: true,
                is_free: true, schedule: true, config: true, duration_minutes: true,
                test_type: true, tags: true, status: true, question_count: true
            }
            : true;

        // Fetch tests assigned to FREE audience (must be PUBLISHED + assignment ACTIVE)
        const assignments = await prisma.testAssignments.findMany({
            where: {
                audience_type: AUDIENCE_TYPE.FREE,
                status: ASSIGNMENT_STATUS.ACTIVE,
                test: { status: TEST_STATUS.PUBLISHED }
            },
            include: { test: testSelect === true ? true : { select: testSelect } },
            orderBy: { created_at: 'desc' }
        });

        // Fetch tests flagged is_free=true directly — do NOT filter by PUBLISHED
        // because toggle-free may have been used without explicitly publishing the test.
        // Exclude ARCHIVED tests only.
        const freeTests = await prisma.tests.findMany({
            where: {
                is_free: true,
                status: { not: TEST_STATUS.ARCHIVED }
            },
            select: testSelect === true ? undefined : testSelect,
            orderBy: { created_at: 'desc' }
        });

        const assignedFreeTests = (assignments || []).map(a => formatAssignmentTest(a.test, a));
        const assignedTestIds = new Set(assignedFreeTests.map(t => t.id));
        
        const additionalFreeTests = freeTests
            .filter(t => !assignedTestIds.has(t.id))
            .map(t => ({
                ...t,
                is_free: true,
                audienceType: AUDIENCE_TYPE.FREE,
                assignmentStatus: ASSIGNMENT_STATUS.ACTIVE,
                allowReattempts: true,
                leaderboardEnabled: true
            }));

        res.json([...assignedFreeTests, ...additionalFreeTests].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (err) {
        console.error("GET FREE TESTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch free tests" });
    }
});

/**
 * GET /tests/assignments
 * Admin/teacher: list assignments, optionally by test or batch.
 */
router.get("/assignments", requireAuth, requireTeacher, async (req, res) => {
    const { testId, batchId, audienceType, status } = req.query;
    try {
        const where = {};
        if (testId) where.test_id = testId;
        if (batchId) where.batch_id = batchId;
        if (audienceType) where.audience_type = `${audienceType}`.toUpperCase();
        if (status) where.status = `${status}`.toUpperCase();

        const assignments = await prisma.testAssignments.findMany({
            where,
            include: {
                test: { select: { id: true, name: true, status: true, test_type: true, tags: true } },
                batch: { select: { id: true, title: true } }
            },
            orderBy: { created_at: "desc" }
        });
        res.json(assignments || []);
    } catch (err) {
        console.error("GET ASSIGNMENTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch test assignments" });
    }
});

/**
 * POST /tests/:id/assignments
 * Admin/teacher: assign a global test to a batch or free audience.
 */
router.post("/:id/assignments", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;
    const {
        batchId,
        batch_id,
        audienceType,
        audience_type,
        schedule,
        status,
        allowReattempts,
        allow_reattempts,
        leaderboardEnabled,
        leaderboard_enabled,
        solutionsReleasePolicy,
        solutions_release_policy
    } = req.body;

    try {
        const test = await prisma.tests.findUnique({ where: { id }, select: { id: true } });
        if (!test) return res.status(404).json({ error: "Test not found" });

        const assignment = await ensureAssignment({
            testId: id,
            batchId: batch_id || batchId,
            audienceType: audience_type || audienceType,
            schedule,
            status,
            allowReattempts: allow_reattempts ?? allowReattempts,
            leaderboardEnabled: leaderboard_enabled ?? leaderboardEnabled,
            solutionsReleasePolicy: solutions_release_policy || solutionsReleasePolicy,
            createdBy: req.user.id
        });

        await prisma.tests.update({
            where: { id },
            data: { status: TEST_STATUS.PUBLISHED }
        });

        res.json(assignment);
    } catch (err) {
        console.error("CREATE ASSIGNMENT ERROR:", err);
        res.status(500).json({ error: "Failed to assign test" });
    }
});

router.get("/:id/assignments", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;
    try {
        const assignments = await prisma.testAssignments.findMany({
            where: { test_id: id },
            include: { batch: { select: { id: true, title: true } } },
            orderBy: { created_at: "desc" }
        });
        res.json(assignments || []);
    } catch (err) {
        console.error("GET TEST ASSIGNMENTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch test assignments" });
    }
});

router.patch("/:id/status", requireAuth, requireTeacher, async (req, res) => {
    const { id } = req.params;
    try {
        const data = await prisma.tests.update({
            where: { id },
            data: { status: normalizeStatus(req.body.status, TEST_STATUS.DRAFT) }
        });
        res.json(data);
    } catch (err) {
        console.error("UPDATE TEST STATUS ERROR:", err);
        res.status(500).json({ error: "Failed to update test status" });
    }
});

/**
 * PUT /tests/assignments/:assignmentId
 */
router.put("/assignments/:assignmentId", requireAuth, requireTeacher, async (req, res) => {
    const { assignmentId } = req.params;
    const updateData = {};
    if (req.body.status !== undefined) updateData.status = normalizeAssignmentStatus(req.body.status);
    if (req.body.schedule !== undefined) updateData.schedule = req.body.schedule || {};
    if (req.body.allowReattempts !== undefined || req.body.allow_reattempts !== undefined) updateData.allow_reattempts = req.body.allow_reattempts ?? req.body.allowReattempts;
    if (req.body.leaderboardEnabled !== undefined || req.body.leaderboard_enabled !== undefined) updateData.leaderboard_enabled = req.body.leaderboard_enabled ?? req.body.leaderboardEnabled;
    if (req.body.solutionsReleasePolicy !== undefined || req.body.solutions_release_policy !== undefined) updateData.solutions_release_policy = req.body.solutions_release_policy || req.body.solutionsReleasePolicy || {};

    try {
        const assignment = await prisma.testAssignments.update({
            where: { id: assignmentId },
            data: updateData
        });
        res.json(assignment);
    } catch (err) {
        console.error("UPDATE ASSIGNMENT ERROR:", err);
        res.status(500).json({ error: "Failed to update test assignment" });
    }
});

/**
 * DELETE /tests/assignments/:assignmentId
 * Archive an assignment without deleting the global test.
 */
router.delete("/assignments/:assignmentId", requireAuth, requireTeacher, async (req, res) => {
    const { assignmentId } = req.params;
    try {
        await prisma.testAssignments.update({
            where: { id: assignmentId },
            data: { status: ASSIGNMENT_STATUS.ARCHIVED }
        });
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE ASSIGNMENT ERROR:", err);
        res.status(500).json({ error: "Failed to archive test assignment" });
    }
});

router.get("/assignments/:assignmentId/leaderboard", requireAuth, async (req, res) => {
    const { assignmentId } = req.params;
    try {
        const data = await prisma.testAttempts.findMany({
            where: { test_assignment_id: assignmentId },
            orderBy: [{ score: "desc" }, { time_taken: "asc" }]
        });
        const leaderboard = (data || [])
            .filter(a => a.is_submitted !== false && a.status?.is_submitted !== false)
            .map((a, idx) => ({ rank: idx + 1, ...formatAttempt(a) }));
        res.json(leaderboard);
    } catch (err) {
        console.error("GET ASSIGNMENT LEADERBOARD ERROR:", err);
        res.status(500).json({ error: "Failed to fetch assignment leaderboard" });
    }
});

/**
 * GET /tests
 * Get global tests, or assigned tests when batchId/is_free filters are supplied.
 */
router.get("/", requireAuth, async (req, res) => {
    const { batch, batchId, is_free, status, assigned } = req.query;
    const targetBatchId = batch || batchId;

    try {
        if (targetBatchId || is_free === "true") {
            const whereAssignment = {
                status: ASSIGNMENT_STATUS.ACTIVE,
                test: { status: TEST_STATUS.PUBLISHED }
            };
            if (targetBatchId) {
                whereAssignment.audience_type = AUDIENCE_TYPE.BATCH;
                whereAssignment.batch_id = targetBatchId;
            }
            if (is_free === "true") {
                whereAssignment.audience_type = AUDIENCE_TYPE.FREE;
            }

            const isMetaOnly = req.query.meta_only === 'true';
            const testSelect = isMetaOnly
                ? {
                    id: true, name: true, created_at: true, batch_id: true,
                    is_free: true, schedule: true, config: true, duration_minutes: true,
                    test_type: true, tags: true, status: true, question_count: true
                }
                : true; // true = include all fields

            const assignments = await prisma.testAssignments.findMany({
                where: whereAssignment,
                include: { test: testSelect === true ? true : { select: testSelect } },
                orderBy: { created_at: "desc" }
            });

            return res.json((assignments || []).map(a => formatAssignmentTest(a.test, a)));
        }

        const whereClause = {};

        if (status) {
            whereClause.status = `${status}`.toUpperCase();
        } else if (req.user.role !== "ADMIN" && req.user.role !== "TEACHER") {
            whereClause.status = TEST_STATUS.PUBLISHED;
        }

        if (assigned === "false") {
            whereClause.testAssignments = { none: {} };
        } else if (assigned === "true") {
            whereClause.testAssignments = { some: {} };
        }

        // Support meta_only filter
        const selectClause = req.query.meta_only === 'true'
            ? {
                id: true, name: true, created_at: true, batch_id: true,
                is_free: true, schedule: true, config: true, duration_minutes: true,
                test_type: true, tags: true, status: true, question_count: true
            }
            : undefined;

        const data = await prisma.tests.findMany({
            where: whereClause,
            select: selectClause,
            include: selectClause ? undefined : {
                testAssignments: {
                    include: { batch: { select: { id: true, title: true } } }
                }
            },
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
        const isMetaOnly = req.query.meta_only === 'true';

        const data = await prisma.testAttempts.findMany({
            where: { student_id: req.user.id },
            select: isMetaOnly ? {
                id: true, test_id: true, test_assignment_id: true, student_id: true,
                student_name: true, score: true, max_score: true, accuracy: true,
                time_taken: true, is_submitted: true, created_at: true
            } : undefined,
            orderBy: { created_at: 'desc' }
        });

        res.json((data || []).map(formatAttempt));
    } catch (err) {
        console.error("GET MY ATTEMPTS ERROR:", err);
        res.status(500).json({ error: "Failed to fetch attempts" });
    }
});

/**
 * GET /tests/attempts/:attemptId
 * Get a specific attempt for current student
 */
router.get("/attempts/:attemptId", requireAuth, async (req, res) => {
    try {
        const data = await prisma.testAttempts.findUnique({
            where: { id: req.params.attemptId }
        });

        if (!data) return res.status(404).json({ error: "Attempt not found" });
        if (data.student_id !== req.user.id && req.user.role === 'STUDENT') {
            return res.status(403).json({ error: "Not authorized" });
        }

        res.json(formatAttempt(data));
    } catch (err) {
        console.error("GET ATTEMPT ERROR:", err);
        res.status(500).json({ error: "Failed to fetch attempt" });
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

    if (!finalName) {
        return res.status(400).json({ error: "name is required" });
    }

    try {
        const isV2Test = isPdf2CbtV2Payload(req.body);
        const finalConfig = isV2Test ? normalizeV2Config(req.body) : (config || {});
        const finalQuestions = isV2Test ? (getProvidedTestData(req.body) || {}) : (questions || []);
        const providedAnswerKey = answer_key ?? answerKey ?? getProvidedAnswerKey(req.body);
        const finalAnswerKey = isV2Test
            ? (providedAnswerKey || {})
            : extractAnswerKey(questions);
        const shouldCreateAssignment = !!finalBatchId;
        const isFree = finalBatchId === FREE_TESTS_BATCH_ID;
        const finalStatus = shouldCreateAssignment ? TEST_STATUS.PUBLISHED : normalizeStatus(req.body.status, TEST_STATUS.DRAFT);

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
            batch_id: null,
            name: finalName,
            config: finalConfig,
            schedule: schedule || {},
            questions: finalQuestions,
            answer_key: finalAnswerKey,
            duration_minutes: getDurationMinutes(req.body, finalConfig),
            tags: tags || [],
            created_by: req.user.id,
            is_free: false,
            test_type: test_type || 'FULL_SYLLABUS',
            status: finalStatus,
            question_count: computeQuestionCount(req.body)
        };

        const data = await prisma.tests.create({
            data: insertData
        });

        if (shouldCreateAssignment) {
            const assignment = await prisma.testAssignments.create({
                data: {
                    id: randomUUID(),
                    test_id: data.id,
                    audience_type: isFree ? AUDIENCE_TYPE.FREE : AUDIENCE_TYPE.BATCH,
                    batch_id: isFree ? null : finalBatchId,
                    status: ASSIGNMENT_STATUS.ACTIVE,
                    schedule: schedule || {},
                    allow_reattempts: true,
                    leaderboard_enabled: true,
                    solutions_release_policy: {},
                    created_by: req.user.id
                }
            });
            return res.json(formatAssignmentTest(data, assignment));
        }

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

    if (!importSource) {
        return res.status(400).json({ error: "valid testData is required" });
    }

    try {
        const imported = importSource;
        const shouldCreateAssignment = !!finalBatchId;
        const isFree = finalBatchId === FREE_TESTS_BATCH_ID;
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
            batch_id: null,
            name: imported.name || "Imported Test",
            config: finalConfig,
            schedule: imported.schedule || {},
            questions: finalQuestions,
            answer_key: answerKey,
            duration_minutes: getDurationMinutes(imported, finalConfig),
            tags: imported.tags || [],
            created_by: req.user.id,
            is_free: false,
            test_type: imported.test_type || 'FULL_SYLLABUS',
            status: shouldCreateAssignment ? TEST_STATUS.PUBLISHED : normalizeStatus(imported.status, TEST_STATUS.DRAFT),
            question_count: computeQuestionCount(imported)
        };

        const data = await prisma.tests.create({
            data: insertData
        });

        if (shouldCreateAssignment) {
            const assignment = await prisma.testAssignments.create({
                data: {
                    id: randomUUID(),
                    test_id: data.id,
                    audience_type: isFree ? AUDIENCE_TYPE.FREE : AUDIENCE_TYPE.BATCH,
                    batch_id: isFree ? null : finalBatchId,
                    status: ASSIGNMENT_STATUS.ACTIVE,
                    schedule: imported.schedule || {},
                    allow_reattempts: true,
                    leaderboard_enabled: true,
                    solutions_release_policy: {},
                    created_by: req.user.id
                }
            });
            return res.json(formatAssignmentTest(data, assignment));
        }

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
    const { assignmentId, testAssignmentId } = req.query;
    const finalAssignmentId = assignmentId || testAssignmentId;

    try {
        let testIdsToQuery = [id];

        // If no specific assignment is requested (e.g. from Test Center for a global test),
        // we should also include attempts from any legacy copies of this test.
        // Legacy tests were copied entirely, so they have different test_ids but the same name.
        if (!finalAssignmentId) {
            const test = await prisma.tests.findUnique({ where: { id }, select: { name: true } });
            if (test && test.name) {
                const copies = await prisma.tests.findMany({ 
                    where: { name: test.name },
                    select: { id: true }
                });
                if (copies.length > 0) {
                    testIdsToQuery = copies.map(c => c.id);
                }
            }
        }

        const data = await prisma.testAttempts.findMany({
            where: {
                test_id: { in: testIdsToQuery },
                ...(finalAssignmentId ? { test_assignment_id: finalAssignmentId } : {})
            },
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
            ...formatAttempt(a),
            studentName: a.student_name || 'Anonymous'
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
        isSubmitted,
        assignmentId,
        testAssignmentId,
        test_assignment_id
    } = req.body;

    const finalIsSubmitted = isSubmitted !== false; // defaults to true if undefined
    const finalAssignmentId = test_assignment_id || testAssignmentId || assignmentId || null;

    try {
        if (finalAssignmentId) {
            const assignment = await prisma.testAssignments.findUnique({
                where: { id: finalAssignmentId },
                select: { id: true, test_id: true, status: true }
            });
            if (!assignment || assignment.test_id !== id) {
                return res.status(404).json({ error: "Test assignment not found" });
            }
            if (assignment.status !== ASSIGNMENT_STATUS.ACTIVE) {
                return res.status(403).json({ error: "Test assignment is not active" });
            }
        }

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
                ...(finalAssignmentId ? { test_assignment_id: finalAssignmentId } : {}),
                student_id: req.user.id,
                is_submitted: false
            },
            select: { id: true },
            orderBy: { created_at: 'desc' },
            take: 1
        });

        const unsubmittedAttempt = existingAttempts?.[0] || null;

        const statusObj = { ...(status || {}) };
        statusObj.is_submitted = finalIsSubmitted;
        const timeSpentObj = timeSpent || time_spent || {};
        let finalScore = score ?? 0;
        let finalMaxScore = maxScore ?? max_score ?? 0;
        let finalAccuracy = accuracy ?? 0;
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
            test_assignment_id: finalAssignmentId,
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

        res.json(formatAttempt(data));
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
        if (req.body.status !== undefined) updateData.status = normalizeStatus(req.body.status);
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

        // Always update question_count when questions or config are being written
        if (updateData.questions !== undefined || updateData.config !== undefined) {
            updateData.question_count = computeQuestionCount({
                ...req.body,
                config: updateData.config ?? req.body.config,
                questions: updateData.questions ?? req.body.questions
            });
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

        await prisma.$transaction([
            prisma.bookmarkTagRelations.deleteMany({
                where: { bookmark: { test_id: id } }
            }),
            prisma.bookmarks.deleteMany({
                where: { test_id: id }
            }),
            prisma.testAttempts.deleteMany({
                where: { test_id: id }
            }),
            prisma.testAssignments.deleteMany({
                where: { test_id: id }
            }),
            prisma.tests.delete({
                where: { id }
            })
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error("DELETE TEST ERROR:", err);
        res.status(500).json({ error: "Failed to delete test" });
    }
});

/**
 * @route   PATCH /tests/:id/toggle-free
 * @desc    Toggle is_free flag on a test
 * @access  Private (Admin only)
 */
router.patch("/:id/toggle-free", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { isFree } = req.body;
    
    try {
        const updateData = { is_free: Boolean(isFree) };
        // Auto-publish the test when marking it as free so it appears on the free tests page.
        // When un-marking, we leave the status as-is (admin can archive/unpublish separately).
        if (Boolean(isFree)) {
            updateData.status = TEST_STATUS.PUBLISHED;
        }

        const test = await prisma.tests.update({
            where: { id },
            data: updateData
        });
        
        res.json({ success: true, is_free: test.is_free, status: test.status });
    } catch (err) {
        console.error("TOGGLE FREE ERROR:", err);
        res.status(500).json({ error: "Failed to toggle test free status" });
    }
});

module.exports = router;
