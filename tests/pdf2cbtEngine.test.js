const test = require("node:test");
const assert = require("node:assert/strict");
const { calculatePdf2CbtScore, evaluateQuestion } = require("../services/pdf2cbtEngine");

function question(overrides = {}) {
    return {
        type: "mcq",
        status: "answered",
        answer: 1,
        marks: { cm: 4, pm: 1, im: -1, max: 4 },
        ...overrides,
    };
}

test("scores MCQ correct, incorrect, and unanswered", () => {
    assert.equal(evaluateQuestion(question({ answer: 2 }), 2).marks, 4);
    assert.equal(evaluateQuestion(question({ answer: 1 }), 2).marks, -1);
    assert.equal(evaluateQuestion(question({ status: "notAnswered", answer: null }), 2).marks, 0);
});

test("supports MCQ alternate correct answers", () => {
    const result = evaluateQuestion(question({ answer: 2 }), [1, 2]);

    assert.equal(result.status, "correct");
    assert.equal(result.marks, 4);
});

test("scores MSQ full, partial, and wrong-option answers", () => {
    const base = question({ type: "msq", marks: { cm: 4, pm: 1, im: -2, max: 4 } });

    assert.deepEqual(
        {
            status: evaluateQuestion({ ...base, answer: [1, 2, 3] }, [1, 2, 3]).status,
            marks: evaluateQuestion({ ...base, answer: [1, 2, 3] }, [1, 2, 3]).marks,
        },
        { status: "correct", marks: 4 }
    );
    assert.deepEqual(
        {
            status: evaluateQuestion({ ...base, answer: [1, 3] }, [1, 2, 3]).status,
            marks: evaluateQuestion({ ...base, answer: [1, 3] }, [1, 2, 3]).marks,
        },
        { status: "partial", marks: 2 }
    );
    assert.deepEqual(
        {
            status: evaluateQuestion({ ...base, answer: [1, 4] }, [1, 2, 3]).status,
            marks: evaluateQuestion({ ...base, answer: [1, 4] }, [1, 2, 3]).marks,
        },
        { status: "incorrect", marks: -2 }
    );
});

test("scores NAT exact, multiple accepted values, and ranges", () => {
    const base = question({ type: "nat", marks: { cm: 4, im: -1 } });

    assert.equal(evaluateQuestion({ ...base, answer: "1.25" }, "1.25").status, "correct");
    assert.equal(evaluateQuestion({ ...base, answer: "3" }, "1, 2, 3").status, "correct");
    assert.equal(evaluateQuestion({ ...base, answer: "1.30" }, "1.25 TO 1.35").status, "correct");
    assert.deepEqual(
        {
            status: evaluateQuestion({ ...base, answer: "1.40" }, "1.25 TO 1.35").status,
            marks: evaluateQuestion({ ...base, answer: "1.40" }, "1.25 TO 1.35").marks,
        },
        { status: "incorrect", marks: -1 }
    );
});

test("scores MSM row-wise with partial status when rows differ", () => {
    const result = evaluateQuestion(
        question({
            type: "msm",
            answer: { 1: [1, 2], 2: [3], 3: [4] },
            marks: { cm: 2, im: -1, max: 6 },
        }),
        { 1: [1, 2], 2: [2], 3: [4] }
    );

    assert.equal(result.status, "partial");
    assert.equal(result.marks, 3);
    assert.equal(result.maxMarks, 6);
});

test("awards full marks for dropped and answered bonus questions", () => {
    assert.deepEqual(
        {
            status: evaluateQuestion(question({ status: "notAnswered", answer: null }), "DROPPED").status,
            marks: evaluateQuestion(question({ status: "notAnswered", answer: null }), "DROPPED").marks,
        },
        { status: "dropped", marks: 4 }
    );
    assert.deepEqual(
        {
            status: evaluateQuestion(question({ answer: 3 }), "BONUS").status,
            marks: evaluateQuestion(question({ answer: 3 }), "BONUS").marks,
        },
        { status: "bonus", marks: 4 }
    );
});

test("calculates aggregate score, accuracy, subject scores, and question results", () => {
    const testData = {
        Physics: {
            "Section A": {
                1: { queId: 101, type: "mcq", marks: { cm: 4, im: -1, max: 4 }, pdfData: {} },
                2: { queId: 102, type: "msq", marks: { cm: 4, pm: 1, im: -2, max: 4 }, pdfData: {} },
            },
        },
        Chemistry: {
            "Section A": {
                1: { queId: 201, type: "nat", marks: { cm: 4, im: -1, max: 4 }, pdfData: {} },
            },
        },
    };
    const answerKey = {
        Physics: {
            "Section A": {
                1: { type: "mcq", correctAnswer: 2 },
                2: { type: "msq", correctAnswer: [1, 2, 3] },
            },
        },
        Chemistry: {
            "Section A": {
                1: { type: "nat", correctAnswer: "1.25 TO 1.35" },
            },
        },
    };
    const result = calculatePdf2CbtScore({
        testData,
        answerKey,
        answers: {
            101: 2,
            102: [1, 3],
            201: "1.3",
        },
    });

    assert.equal(result.score, 10);
    assert.equal(result.maxScore, 12);
    assert.equal(result.accuracy, 89);
    assert.deepEqual(result.subjectScores, { Physics: 6, Chemistry: 4 });
    assert.equal(result.questionResults.length, 3);
    assert.equal(result.partial, 1);
});
