const ANSWERED_STATUSES = new Set(["answered", "markedAnswered"]);
const EMPTY_ANSWERS = new Set([undefined, null, "", -1]);

function normalizeMarks(questionData = {}) {
    const marks = questionData.marks || {};
    const cm = Math.abs(Number(marks.cm ?? 0));
    const pm = Math.abs(Number(marks.pm ?? 0));
    const im = Math.abs(Number(marks.im ?? 0)) * -1;
    const max = Math.abs(Number(marks.max ?? 0)) || cm;

    return { cm, pm, im, max };
}

function hasSubstantiveAnswer(answer) {
    if (EMPTY_ANSWERS.has(answer)) return false;
    if (Array.isArray(answer)) return answer.length > 0;
    if (typeof answer === "object") {
        return Object.values(answer).some(value => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "");
    }
    return true;
}

function normalizeStatus(status, answer) {
    if (status === "markedAnswered") return "markedAnswered";
    if (status === "answered") return "answered";
    if (status === "marked") return "marked";
    if (status === "notVisited") return "notVisited";
    if (status === "notAnswered") return "notAnswered";
    return hasSubstantiveAnswer(answer) ? "answered" : "notAnswered";
}

function normalizeNumberArray(value) {
    if (Array.isArray(value)) return value.map(Number).filter(n => !Number.isNaN(n));
    if (value === undefined || value === null || value === "") return [];
    return [Number(value)].filter(n => !Number.isNaN(n));
}

function setsHaveSameNumbers(left, right) {
    const leftSet = new Set(normalizeNumberArray(left));
    const rightSet = new Set(normalizeNumberArray(right));
    return leftSet.size === rightSet.size && [...leftSet].every(value => rightSet.has(value));
}

function evaluateNatAnswer(answer, correctAnswer) {
    const answerFloat = parseFloat(`${answer}`);
    if (Number.isNaN(answerFloat)) return false;

    const possibleAnswers = `${correctAnswer}`.split(",").map(part => part.trim()).filter(Boolean);
    return possibleAnswers.some(possibleAnswer => {
        const normalized = possibleAnswer.toUpperCase();
        if (normalized.includes("TO")) {
            const [lowerLimit, upperLimit] = normalized.split("TO").map(part => parseFloat(part.trim()));
            return !Number.isNaN(lowerLimit) && !Number.isNaN(upperLimit) && answerFloat >= lowerLimit && answerFloat <= upperLimit;
        }

        return parseFloat(normalized) === answerFloat;
    });
}

function evaluateQuestion(questionData, questionCorrectAnswer) {
    const type = questionData.type;
    const answer = questionData.answer;
    const status = normalizeStatus(questionData.status, answer);
    const marks = normalizeMarks(questionData);

    const result = {
        marks: 0,
        status: "notAnswered",
        correctAnswer: questionCorrectAnswer,
        answer,
        accuracyNumerator: 0,
        maxMarks: marks.max,
    };

    if (questionCorrectAnswer === "DROPPED") {
        result.marks = marks.max || marks.cm;
        result.status = "dropped";
        return result;
    }

    if (!ANSWERED_STATUSES.has(status)) {
        return result;
    }

    if (questionCorrectAnswer === "BONUS") {
        result.marks = marks.max || marks.cm;
        result.status = "bonus";
        return result;
    }

    if (type === "mcq") {
        if (answer === questionCorrectAnswer || (Array.isArray(questionCorrectAnswer) && questionCorrectAnswer.includes(answer))) {
            result.marks = marks.cm;
            result.status = "correct";
            result.accuracyNumerator = 1;
        } else {
            result.marks = marks.im;
            result.status = "incorrect";
        }
        return result;
    }

    if (type === "nat") {
        if (evaluateNatAnswer(answer, questionCorrectAnswer)) {
            result.marks = marks.cm;
            result.status = "correct";
            result.accuracyNumerator = 1;
        } else {
            result.marks = marks.im;
            result.status = "incorrect";
        }
        return result;
    }

    if (type === "msm") {
        const userAnswerEntries = Object.entries(answer || {}).filter(([, cols]) => Array.isArray(cols) && cols.length > 0);
        const correctAnswerEntries = Object.entries(questionCorrectAnswer || {}).filter(([, cols]) => Array.isArray(cols) && cols.length > 0);
        const correctAnswer = Object.fromEntries(correctAnswerEntries);
        const partialAccuracyDenominator = correctAnswerEntries.length || 1;
        let partialAccuracyNumerator = 0;
        const rowStatuses = new Set();

        for (const [rowKey, userAnswerRowValues] of userAnswerEntries) {
            const correctAnswerRowValues = correctAnswer[rowKey];
            if (correctAnswerRowValues && setsHaveSameNumbers(correctAnswerRowValues, userAnswerRowValues)) {
                result.marks += marks.cm;
                rowStatuses.add("correct");
                partialAccuracyNumerator++;
            } else {
                result.marks += marks.im;
                rowStatuses.add("incorrect");
            }
        }

        if (rowStatuses.size === 1) {
            result.status = [...rowStatuses][0];
        } else if (rowStatuses.size > 1) {
            result.status = "partial";
        }

        if (result.status === "correct") {
            result.accuracyNumerator = 1;
        } else if (result.status === "partial") {
            const relativeAccuracy = (partialAccuracyNumerator / partialAccuracyDenominator) * 100;
            result.accuracyNumerator = Math.round(relativeAccuracy) / 100;
        }
        return result;
    }

    const userAnswers = new Set(normalizeNumberArray(answer));
    const correctAnswers = new Set(normalizeNumberArray(questionCorrectAnswer));
    const isUserAnswersSubsetOfCorrectAnswers = [...userAnswers].every(value => correctAnswers.has(value));

    if (isUserAnswersSubsetOfCorrectAnswers) {
        if (userAnswers.size === correctAnswers.size) {
            result.marks = marks.cm;
            result.status = "correct";
            result.accuracyNumerator = 1;
        } else {
            const partialPerCorrect = marks.pm > 0 ? marks.pm : 1;
            result.marks = partialPerCorrect * userAnswers.size;
            result.status = "partial";
            result.accuracyNumerator = correctAnswers.size > 0 ? Math.round((userAnswers.size / correctAnswers.size) * 100) / 100 : 0;
        }
    } else {
        result.marks = marks.im;
        result.status = "incorrect";
    }

    return result;
}

function getNestedValue(data, subject, section, question) {
    return data?.[subject]?.[section]?.[question];
}

function firstDefinedValue(data, candidates) {
    if (!data || typeof data !== "object") return undefined;
    for (const candidate of candidates) {
        if (Object.prototype.hasOwnProperty.call(data, candidate)) {
            return data[candidate];
        }
    }
    return undefined;
}

function getAttemptValue(data, subject, section, question, questionData) {
    const nestedValue = getNestedValue(data, subject, section, question);
    if (nestedValue !== undefined) return nestedValue;

    const queId = questionData.queId ?? questionData.secQueId ?? question;
    return firstDefinedValue(data, [
        `${subject}.${section}.${question}`,
        `${subject}|${section}|${question}`,
        `${section}.${question}`,
        `${section}|${question}`,
        `${queId}`,
        `${question}`,
    ]);
}

function buildQuestionResultEntry(subject, section, question, questionData, keyData, attemptData = {}) {
    const answer = getAttemptValue(attemptData.answers, subject, section, question, questionData);
    const status = getAttemptValue(attemptData.status, subject, section, question, questionData);
    const timeSpent = getAttemptValue(attemptData.timeSpent, subject, section, question, questionData);
    const questionForEvaluation = {
        ...questionData,
        type: questionData.type || keyData.type,
        answer: answer !== undefined ? answer : questionData.answer,
        status: status !== undefined ? status : questionData.status,
    };
    const result = evaluateQuestion(questionForEvaluation, keyData.correctAnswer);

    return {
        subject,
        section,
        question: String(question),
        queId: questionData.queId ?? questionData.secQueId ?? question,
        type: questionForEvaluation.type,
        answer: questionForEvaluation.answer,
        status: result.status,
        attemptStatus: normalizeStatus(questionForEvaluation.status, questionForEvaluation.answer),
        correctAnswer: keyData.correctAnswer,
        marks: result.marks,
        maxMarks: result.maxMarks,
        accuracyNumerator: result.accuracyNumerator,
        timeSpent: Number(timeSpent || questionData.timeSpent || 0),
    };
}

function calculatePdf2CbtScore({ testData = {}, answerKey = {}, answers = {}, status = {}, timeSpent = {} }) {
    const questionResults = [];
    const subjectScores = {};
    const sectionScores = {};
    const counts = {
        correct: 0,
        incorrect: 0,
        partial: 0,
        notAnswered: 0,
        bonus: 0,
        dropped: 0,
    };
    let score = 0;
    let maxScore = 0;
    let accuracyNumerator = 0;
    let totalQuestions = 0;

    for (const [subject, subjectData] of Object.entries(testData || {})) {
        subjectScores[subject] = subjectScores[subject] || 0;

        for (const [section, sectionData] of Object.entries(subjectData || {})) {
            const sectionKey = `${subject}::${section}`;
            sectionScores[sectionKey] = sectionScores[sectionKey] || { subject, section, score: 0, maxScore: 0 };

            for (const [question, questionData] of Object.entries(sectionData || {})) {
                const keyData = answerKey?.[subject]?.[section]?.[question];
                if (!keyData) continue;

                const entry = buildQuestionResultEntry(subject, section, question, questionData, keyData, { answers, status, timeSpent });
                questionResults.push(entry);

                score += entry.marks;
                maxScore += entry.maxMarks;
                accuracyNumerator += entry.accuracyNumerator;
                totalQuestions++;
                subjectScores[subject] += entry.marks;
                sectionScores[sectionKey].score += entry.marks;
                sectionScores[sectionKey].maxScore += entry.maxMarks;

                if (Object.prototype.hasOwnProperty.call(counts, entry.status)) {
                    counts[entry.status]++;
                }
            }
        }
    }

    return {
        score,
        maxScore,
        accuracy: totalQuestions > 0 ? Number(((accuracyNumerator / totalQuestions) * 100).toFixed(2)) : 0,
        correct: counts.correct,
        incorrect: counts.incorrect,
        partial: counts.partial,
        unanswered: counts.notAnswered,
        bonus: counts.bonus,
        dropped: counts.dropped,
        subjectScores,
        sectionScores,
        questionResults,
        totalQuestions,
    };
}

module.exports = {
    calculatePdf2CbtScore,
    evaluateQuestion,
    normalizeMarks,
};
