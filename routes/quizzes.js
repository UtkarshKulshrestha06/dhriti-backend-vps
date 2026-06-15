const express = require('express');
const router = express.Router();
const prisma = require('../services/prisma');
const { requireAuth } = require('../middleware/auth');
const { generateQuiz, hasExceededDailyLimit } = require('../services/geminiQuizService');
const { calculatePdf2CbtScore } = require('../services/pdf2cbtEngine');

/**
 * @route   POST /quizzes
 * @desc    Generate a new AI quiz
 * @access  Private
 */
router.post('/', requireAuth, async (req, res) => {
    try {
        const { stream, subject, numQuestions, durationMinutes, difficulty, chapters, questionType } = req.body;
        const user = req.user;

        // Validation
        if (!['JEE', 'NEET', 'FOUNDATION'].includes(stream)) {
            return res.status(400).json({ error: 'Invalid stream' });
        }
        if (!subject || !numQuestions || numQuestions < 1 || numQuestions > 25) {
            return res.status(400).json({ error: 'Invalid subject or number of questions (1-25)' });
        }
        if (!durationMinutes || durationMinutes < 1) {
            return res.status(400).json({ error: 'Invalid duration' });
        }

        // Check limits
        const limitExceeded = await hasExceededDailyLimit(user.id, user.role);
        if (limitExceeded) {
            return res.status(429).json({ error: 'Daily quiz generation limit exceeded.' });
        }

        // Generate Quiz via Gemini
        const quizData = await generateQuiz(stream, subject, numQuestions, difficulty, chapters, questionType);

        // Build config mapping
        const config = {
            schemaVersion: 2,
            engine: "pdf2cbt",
            aiSettings: {
                difficulty: difficulty || 'normal',
                chapters: chapters || 'all',
                questionType: questionType || 'both'
            },
            testConfig: {
                name: `${stream} ${subject} Quiz - ${numQuestions} Qs`,
                durationMinutes: durationMinutes,
                pattern: "custom",
                subjects: [subject],
                sections: [{
                    subject: subject,
                    name: subject,
                    questionType: "mcq" // Defaulting to mcq as mixed is handled
                }]
            }
        };

        // Store in database
        const newQuiz = await prisma.quizzes.create({
            data: {
                user_id: user.id,
                stream,
                subject,
                num_questions: quizData.questions.length, // actual generated
                duration_minutes: durationMinutes,
                title: config.testConfig.name,
                questions: quizData.questions,
                answer_key: quizData.answerKey,
                config: config,
                status: 'ready'
            }
        });

        res.status(201).json(newQuiz);
    } catch (error) {
        console.error("Error creating AI Quiz:", error);
        res.status(500).json({ error: error.message || 'Server error generating quiz' });
    }
});

/**
 * @route   GET /quizzes
 * @desc    Get all quizzes for the current user
 * @access  Private
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const quizzes = await prisma.quizzes.findMany({
            where: { user_id: req.user.id },
            orderBy: { created_at: 'desc' },
            include: {
                quizAttempts: {
                    orderBy: { created_at: 'desc' },
                    take: 1
                }
            }
        });
        
        // Map to include latest attempt directly
        const formatted = quizzes.map(q => {
            const { quizAttempts, ...quizData } = q;
            return {
                ...quizData,
                latestAttempt: quizAttempts.length > 0 ? quizAttempts[0] : null
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching quizzes:", error);
        res.status(500).json({ error: 'Server error fetching quizzes' });
    }
});

/**
 * @route   GET /quizzes/:id
 * @desc    Get single quiz data
 * @access  Private
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const quiz = await prisma.quizzes.findUnique({
            where: { id: req.params.id }
        });

        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        if (quiz.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        res.json(quiz);
    } catch (error) {
        console.error("Error fetching quiz:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @route   DELETE /quizzes/:id
 * @desc    Delete a quiz
 * @access  Private
 */
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const quiz = await prisma.quizzes.findUnique({
            where: { id: req.params.id }
        });

        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        if (quiz.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        await prisma.quizzes.delete({
            where: { id: req.params.id }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting quiz:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * @route   POST /quizzes/:id/attempts
 * @desc    Submit an attempt for a quiz
 * @access  Private
 */
router.post('/:id/attempts', requireAuth, async (req, res) => {
    try {
        const { answers, status, timeSpent } = req.body;
        const quizId = req.params.id;

        const quiz = await prisma.quizzes.findUnique({
            where: { id: quizId }
        });

        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
        if (quiz.user_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        // Reconstruct testData and answerKey in the structure expected by pdf2cbtEngine
        const testData = {
            [quiz.subject]: {
                [quiz.subject]: {}
            }
        };

        const answerKeyData = {
            [quiz.subject]: {
                [quiz.subject]: {}
            }
        };

        quiz.questions.forEach((q, index) => {
            const key = String(index);
            testData[quiz.subject][quiz.subject][key] = {
                secQueId: index + 1,
                queId: index + 1,
                type: q.type,
                questionText: q.questionText,
                options: q.options,
                marks: { 
                    cm: q.marks?.correct || 4, 
                    im: q.marks?.incorrect !== undefined ? q.marks.incorrect : -1 
                },
                pdfData: { page: 1 }
            };
        });

        quiz.answer_key.forEach((ak) => {
            const key = String(ak.questionIndex);
            answerKeyData[quiz.subject][quiz.subject][key] = {
                type: ak.type,
                correctAnswer: ak.answer
            };
        });

        // Score using the PDF2CBT engine
        const result = calculatePdf2CbtScore({
            testData,
            answerKey: answerKeyData,
            answers: answers || {},
            status: status || {},
            timeSpent: timeSpent || {}
        });

        const attempt = await prisma.quizAttempts.create({
            data: {
                quiz_id: quizId,
                user_id: req.user.id,
                score: result.score,
                max_score: result.maxScore,
                accuracy: result.accuracy,
                time_taken: Object.values(timeSpent || {}).reduce((a, b) => a + b, 0),
                answers: answers || {},
                status: status || {},
                time_spent: timeSpent || {},
                result: result
            }
        });

        res.status(201).json(attempt);
    } catch (error) {
        console.error("Error submitting quiz attempt:", error);
        res.status(500).json({ error: 'Server error submitting attempt' });
    }
});

/**
 * @route   GET /quizzes/:id/attempts
 * @desc    Get all attempts for a quiz
 * @access  Private
 */
router.get('/:id/attempts', requireAuth, async (req, res) => {
    try {
        const attempts = await prisma.quizAttempts.findMany({
            where: {
                quiz_id: req.params.id,
                user_id: req.user.id
            },
            orderBy: { created_at: 'desc' }
        });

        res.json(attempts);
    } catch (error) {
        console.error("Error fetching quiz attempts:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
