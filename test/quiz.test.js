"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const sourceRoot = path.join(__dirname, "..");
const answerKey = require("../private/quiz-answer-key.json");
const context = vm.createContext({
  window: {
    PGParticipantService: {
      save: attempt => attempt
    }
  }
});
vm.runInContext(fs.readFileSync(path.join(sourceRoot, "js", "data.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(sourceRoot, "js", "quiz-service.js"), "utf8"), context);
const questions = vm.runInContext("QUESTIONS", context);
const quiz = context.window.PGQuizService;

test("question bank has 40 distinct, keyed beginner/intermediate/advanced scenarios", () => {
  assert.deepEqual([...quiz.roundSizes], [15, 15, 10]);
  assert.equal(questions.length, 40);
  assert.equal(new Set(questions.map(question => question.id)).size, 40);
  assert.equal(new Set(questions.map(question => question.title)).size, 40);
  assert.deepEqual(
    questions.reduce((counts, question) => {
      counts[question.difficulty] = (counts[question.difficulty] || 0) + 1;
      return counts;
    }, {}),
    { easy: 15, medium: 15, hard: 10 }
  );
  for (const question of questions) {
    const key = answerKey[question.id];
    assert.ok(key, `Missing private key for ${question.id}`);
    assert.equal(key.round, ({ easy: 1, medium: 2, hard: 3 })[question.difficulty]);
    assert.ok(["legitimate", "phishing"].includes(key.answer));
    assert.ok(key.explanation.length > 20);
  }
});

test("client question data contains no answer keys or explanations", () => {
  for (const question of questions) {
    for (const privateField of ["answer", "flags", "explanation", "tip"]) {
      assert.equal(Object.hasOwn(question, privateField), false, `${question.id} exposes ${privateField}`);
    }
  }
  assert.equal(fs.existsSync(path.join(sourceRoot, "private", "quiz-answer-key.json")), true);
});

test("advanced questions include email-header, QR, domain, social-engineering, and auth evidence", () => {
  const advanced = questions.filter(question => question.difficulty === "hard");
  const serialized = JSON.stringify(advanced);
  assert.match(serialized, /Authentication-Results/);
  assert.match(serialized, /dmarc=fail/);
  assert.ok(advanced.some(question => question.type === "qr" && question.scanned));
  assert.match(serialized, /vidyanagar-institute\.edu\.payroll-correction\.net/);
  assert.ok(advanced.some(question => question.messages && question.messages.length > 1));
  assert.match(serialized, /6-digit code|six-digit|sign-in approval|password and bank details/i);
});

test("question selection, progression, progress index, and hints follow each round", () => {
  const ids = quiz.selectQuestions();
  assert.equal(ids.length, 40);
  assert.equal(new Set(ids).size, 40);
  const byId = new Map(questions.map(question => [question.id, question]));
  const attempt = {
    questionIds: ids,
    answers: [],
    currentRound: 1,
    currentQuestion: 0
  };
  let overallIndex = 0;

  for (let round = 1; round <= 3; round++) {
    assert.equal(quiz.roundSize(round), [15, 15, 10][round - 1]);
    for (let questionIndex = 0; questionIndex < quiz.roundSize(round); questionIndex++) {
      const question = quiz.questionAt(attempt);
      assert.ok(question);
      assert.equal(question.difficulty, ["easy", "medium", "hard"][round - 1]);
      assert.equal(quiz.overallIndex(attempt), overallIndex);
      if (round === 1) assert.ok(quiz.hintFor(question), `${question.id} should have a beginner hint`);
      else assert.equal(quiz.hintFor(question), null, `${question.id} must not have a hint`);
      quiz.saveAnswer(attempt, "phishing");
      overallIndex++;
    }
    if (round < 3) {
      attempt.currentRound++;
      attempt.currentQuestion = 0;
    }
  }
  assert.equal(overallIndex, 40);
  assert.equal(attempt.answers.length, 40);
});
