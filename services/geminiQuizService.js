const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const prisma = require('./prisma');
require('dotenv').config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// We use gemini-3.1-flash-lite for JSON generation
const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

const STREAM_PROMPTS = {
    'JEE': `You are an expert JEE (Joint Entrance Examination) faculty. Create a quiz with multiple choice questions (MCQ) and numerical value questions (NUMERICAL) for JEE Main level. The subjects are Physics, Chemistry, and Mathematics. Focus on conceptual clarity, calculations, and analytical thinking.`,
    
    'NEET': `You are an expert NEET (National Eligibility cum Entrance Test) faculty. Create a quiz with multiple choice questions (MCQ) for NEET level. The subjects are Physics, Chemistry, and Biology (Botany and Zoology). Focus on NCERT syllabus, recall-based questions, and conceptual understanding. Do NOT include NUMERICAL type questions, only MCQ.`,
    
    'FOUNDATION': `You are an expert Foundation (Class 9 and 10) faculty preparing students for future competitive exams. Create a quiz with multiple choice questions (MCQ) and numerical value questions (NUMERICAL). The subjects are Physics, Chemistry, Mathematics, and Biology. Keep the difficulty appropriate for Class 9 and 10 students, focusing on building strong fundamentals.`
};

const QUIZ_JSON_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        questions: {
            type: SchemaType.ARRAY,
            description: "List of generated quiz questions",
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    type: {
                        type: SchemaType.STRING,
                        description: "Type of the question. Must be either 'mcq' or 'nat' (Numerical Answer Type). For NEET, use only 'mcq'.",
                    },
                    questionText: {
                        type: SchemaType.STRING,
                        description: "The complete text of the question, including any necessary data or formulas. Use simple text or standard mathematical notation."
                    },
                    options: {
                        type: SchemaType.ARRAY,
                        description: "Array of exactly 4 string options. Only required if type is 'mcq'. If type is 'nat', provide an empty array.",
                        items: { type: SchemaType.STRING }
                    },
                    correctAnswer: {
                        type: SchemaType.STRING,
                        description: "For 'mcq', this should be the 0-based index of the correct option as a string (e.g., '0', '1', '2', '3'). For 'nat', this should be the numerical answer as a string (e.g., '2.5', '10')."
                    },
                    explanation: {
                        type: SchemaType.STRING,
                        description: "A clear, step-by-step explanation of how to solve the question."
                    }
                },
                required: ["type", "questionText", "options", "correctAnswer", "explanation"]
            }
        }
    },
    required: ["questions"]
};

/**
 * Generate a quiz using Gemini API
 * @param {string} stream - JEE, NEET, or FOUNDATION
 * @param {string} subject - Physics, Chemistry, etc.
 * @param {number} numQuestions - Number of questions to generate (max 25)
 * @param {string} difficulty - easy, normal, or hard
 * @param {Array<string>|string} chapters - Array of chapter names or 'all'
 * @param {string} questionType - mcq, numerical, or both
 * @returns {Promise<Object>} The generated quiz data mapped to PDF2CBT format
 */
async function generateQuiz(stream, subject, numQuestions, difficulty = 'normal', chapters = 'all', questionType = 'both') {
    if (!STREAM_PROMPTS[stream]) {
        throw new Error(`Invalid stream: ${stream}`);
    }

    const systemPrompt = STREAM_PROMPTS[stream] + `
CRITICAL FORMATTING RULES FOR MATH & CHEMISTRY:
- You MUST use standard LaTeX wrapped in $$ ... $$ for block equations or $ ... $ for inline math.
- For subscripts, superscripts, chemical formulas, use LaTeX (e.g., $H_2O$, $x^2$, $\\sqrt{x}$).
- Do NOT use plain text notations like x^2 or H2O if they are formulas.
`;

    let difficultyInstruction = "";
    if (difficulty === 'easy') {
        difficultyInstruction = "Difficulty: EASY. Simple questions, formula-based but with some reasoning required. Only one concept from one chapter included. (e.g. simple JEE Main/NEET level).";
    } else if (difficulty === 'normal') {
        difficultyInstruction = "Difficulty: NORMAL. Questions needing more steps and reasoning. Formula-based but including 1-2 similar concepts. (e.g. typical JEE Main/NEET competitive level).";
    } else if (difficulty === 'hard') {
        difficultyInstruction = "Difficulty: HARD. Lengthy to solve, multiple high-reasoning steps. May not directly use a formula. May include >2 concepts from multiple chapters. Real-life problems or derivation based. (e.g. tough JEE Main / tough NEET level).";
    }

    let chapterInstruction = "";
    if (chapters !== 'all' && Array.isArray(chapters) && chapters.length > 0) {
        chapterInstruction = `Strictly restrict the concepts to the following chapters: ${chapters.join(', ')}.`;
    } else {
        chapterInstruction = "The syllabus covers all chapters in the standard curriculum.";
    }

    let typeInstruction = "";
    if (stream === 'NEET') {
        typeInstruction = "Question Type: Strictly 100% MCQ.";
    } else {
        if (questionType === 'mcq') typeInstruction = "Question Type: Strictly 100% MCQ.";
        else if (questionType === 'numerical') typeInstruction = "Question Type: Strictly 100% Numerical Answer Type (NAT).";
        else typeInstruction = "Question Type: A balanced mix of MCQ and Numerical Answer Type (NAT).";
    }

    const userPrompt = `Generate a quiz of ${numQuestions} questions for the subject: ${subject}. 
Ensure the output matches the required JSON schema perfectly.
${difficultyInstruction}
${chapterInstruction}
${typeInstruction}`;

    let lastError = null;
    let currentKey = process.env.GEMINI_API_KEY;
    const altKey = process.env.GEMINI_API_KEY_ALT;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            const currentGenAI = new GoogleGenerativeAI(currentKey);
            const currentModel = currentGenAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

            const result = await currentModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: QUIZ_JSON_SCHEMA,
                    temperature: 0.7,
                }
            });

            const responseText = result.response.text();
            const parsedData = JSON.parse(responseText);

            if (!parsedData.questions || !Array.isArray(parsedData.questions)) {
                throw new Error("Invalid response format from Gemini");
            }

            return transformToPdf2CbtFormat(parsedData.questions, subject, stream);
        } catch (error) {
            console.error(`Gemini attempt ${attempts} failed:`, error.message);
            lastError = error;
            
            // Check for rate limit or high traffic errors to swap key if available
            if (error.message.includes('429') || error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('overloaded')) {
                if (altKey && currentKey !== altKey) {
                    console.log("Switching to alternative Gemini API key for next attempt.");
                    currentKey = altKey;
                } else {
                    // Exponential backoff if we can't swap keys
                    await new Promise(res => setTimeout(res, 2000 * attempts));
                }
            } else if (error instanceof SyntaxError) {
                // JSON parse error, can just retry immediately
            } else {
                // Non-retryable error, throw immediately
                console.error("Non-retryable Gemini error occurred:", error);
                throw new Error("There are many people using the quiz, please try again later.");
            }
        }
    }

    throw new Error("There are many people using the quiz, please try again later.");
}

/**
 * Transform Gemini output to PDF2CBT expected format
 */
function transformToPdf2CbtFormat(geminiQuestions, subject, stream) {
    const questions = [];
    const answerKey = [];

    // Ensure we don't process more questions than requested/generated
    geminiQuestions.forEach((gq, index) => {
        // Validation
        if (!['mcq', 'nat'].includes(gq.type)) gq.type = 'mcq';
        
        const isJeeOrNeet = stream === 'JEE' || stream === 'NEET';
        const incorrectMark = isJeeOrNeet ? -1 : (gq.type === 'nat' ? 0 : -1);
        
        // Build Pdf2CbtQuestion
        const pdfQuestion = {
            questionIndex: index,
            subject: subject,
            section: subject,
            questionNumber: index + 1,
            type: gq.type,
            questionText: gq.questionText,
            explanation: gq.explanation,
            imageUrl: null, // Indicates text-based question
            optionImages: null,
            marks: {
                correct: 4,
                incorrect: incorrectMark,
                partial: 0
            }
        };

        if (gq.type === 'mcq') {
            pdfQuestion.options = gq.options || ['A', 'B', 'C', 'D'];
            answerKey.push({
                questionIndex: index,
                type: 'mcq',
                answer: parseInt(gq.correctAnswer, 10) || 0
            });
        } else if (gq.type === 'nat') {
            pdfQuestion.options = [];
            answerKey.push({
                questionIndex: index,
                type: 'nat',
                answer: gq.correctAnswer
            });
        }

        questions.push(pdfQuestion);
    });

    return { questions, answerKey };
}

/**
 * Check if a user has exceeded their daily quiz generation limit
 * @param {string} userId - User UUID
 * @param {string} role - User role (USER, STUDENT, etc.)
 * @returns {Promise<boolean>} True if limit exceeded
 */
async function hasExceededDailyLimit(userId, role) {
    const isFreeUser = role === 'USER';
    const limit = isFreeUser ? 3 : 6;

    // Get start of current day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const quizCount = await prisma.quizzes.count({
        where: {
            user_id: userId,
            created_at: {
                gte: startOfDay
            }
        }
    });

    return quizCount >= limit;
}

module.exports = {
    generateQuiz,
    hasExceededDailyLimit
};
