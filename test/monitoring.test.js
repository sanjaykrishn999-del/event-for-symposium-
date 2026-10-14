"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { after, before, test } = require("node:test");
const { createApp, rapidFinalEligible, rankRapidFinal } = require("../server");
const answerKey = require("../private/quiz-answer-key.json");
const rapidFinalQuestions = require("../private/rapid-final-questions.json");
const questionIds = Object.keys(answerKey).sort((left, right) =>
  answerKey[left].round - answerKey[right].round || left.localeCompare(right));

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "phishguard-monitor-"));
const testPassword = "a-long-test-password";
const testSalt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const testPasswordHash = `scrypt$${testSalt.toString("hex")}$${crypto.scryptSync(testPassword, testSalt, 64).toString("hex")}`;
let rapidNow = Date.now();
const runtime = createApp({
  adminId: "test-organizer",
  adminPasswordHash: testPasswordHash,
  sessionSecret: "test-session-secret-that-is-long-enough",
  trustProxy: 1,
  dbPath: path.join(tempDirectory, "monitor.sqlite"),
  rapidFinalClock: () => rapidNow
});
let server;
let baseUrl;
let adminCookie = "";
let participantCookie = "";
let quizSessionId = "";

before(async () => {
  server = await new Promise(resolve => {
    const listener = runtime.app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  runtime.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

async function jsonRequest(url, { method = "GET", body, cookie, userAgent } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json", Origin: baseUrl } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(userAgent ? { "User-Agent": userAgent } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  return { response, result };
}

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  return cookie ? cookie.split(";")[0] : "";
}

function participantAttempt(name = "Test Participant") {
  return {
    id: "device-local-id",
    participant: {
      fullName: name,
      college: "Untrusted client value",
      email: "invalid@example.test",
      phone: "",
      department: "Untrusted",
      year: "Untrusted"
    },
    startedAt: new Date(0).toISOString(),
    completedAt: null,
    status: "In Progress",
    questionIds,
    answers: [],
    currentRound: 1,
    currentQuestion: 0,
    totalQuestions: 40,
    roundScores: { 1: 0, 2: 0, 3: 0 },
    score: null,
    accuracy: null
  };
}

async function completedParticipant(name, score) {
  const started = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    body: {
      startRequestId: crypto.randomUUID(),
      participant: {
        fullName: name,
        college: "Example College",
        email: `${crypto.randomUUID()}@example.test`,
        department: "Security",
        year: "I Year"
      },
      round: 1,
      questionNumber: 1
    }
  });
  assert.equal(started.response.status, 201);
  const answers = questionIds.map((questionId, index) => {
    const correct = answerKey[questionId].answer;
    const choice = index < score ? correct : correct === "phishing" ? "legitimate" : "phishing";
    return { questionId, round: answerKey[questionId].round, choice };
  });
  const completedAt = new Date().toISOString();
  const completed = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: cookieFrom(started.response),
    body: {
      quizSessionId: started.result.quizSessionId,
      attempt: {
        ...participantAttempt(name),
        id: started.result.participantId,
        questionIds,
        answers,
        currentRound: 3,
        currentQuestion: 10,
        status: "Completed",
        completedAt
      }
    }
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.result.score, score);
  return {
    cookie: cookieFrom(started.response),
    quizSessionId: started.result.quizSessionId,
    participantId: started.result.participantId,
    completedAt
  };
}

async function readUntil(reader, marker) {
  const decoder = new TextDecoder();
  let text = "";
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        while (!text.includes(marker)) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error(`Event stream closed before receiving ${marker}.`);
          text += decoder.decode(chunk.value, { stream: true });
        }
        return text;
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}.`)), 3000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test("monitoring endpoints require an authenticated admin and same-origin requests", async () => {
  const blocked = await jsonRequest("/api/admin/monitor/snapshot");
  assert.equal(blocked.response.status, 401);

  for (let attempt = 0; attempt < 7; attempt++) {
    const invalid = await jsonRequest("/api/admin/login", {
      method: "POST",
      body: { adminId: "test-organizer", password: "incorrect-password" }
    });
    assert.equal(invalid.response.status, 401);
  }

  const login = await jsonRequest("/api/admin/login", {
    method: "POST",
    body: { adminId: "test-organizer", password: "a-long-test-password" }
  });
  assert.equal(login.response.status, 200);
  adminCookie = cookieFrom(login.response);
  assert.match(login.response.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(login.response.headers.get("set-cookie"), /SameSite=Strict/i);
  assert.match(login.response.headers.get("set-cookie"), /Expires=/i);

  const restored = await jsonRequest("/api/admin/session", { cookie: adminCookie });
  assert.equal(restored.result.authenticated, true);

  const wrongOrigin = await fetch(`${baseUrl}/api/admin/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid", Cookie: adminCookie },
    body: "{}"
  });
  assert.equal(wrongOrigin.status, 403);
});

test("same-origin API requests work behind Render's HTTPS proxy", async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl.replace(/^http:/, "https:"),
      "X-Forwarded-Proto": "https"
    },
    body: JSON.stringify({ adminId: "invalid", password: "invalid" })
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
});

test("logout ends only the current session and the same admin can sign in again", async () => {
  const logout = await jsonRequest("/api/admin/logout", {
    method: "POST",
    body: {},
    cookie: adminCookie
  });
  assert.equal(logout.response.status, 200);
  const oldSession = await jsonRequest("/api/admin/session", { cookie: adminCookie });
  assert.equal(oldSession.result.authenticated, false);

  const nextLogin = await jsonRequest("/api/admin/login", {
    method: "POST",
    body: { adminId: "test-organizer", password: testPassword }
  });
  assert.equal(nextLogin.response.status, 200);
  adminCookie = cookieFrom(nextLogin.response);
  const restored = await jsonRequest("/api/admin/session", { cookie: adminCookie });
  assert.equal(restored.result.authenticated, true);
});

test("participant events are append-only, isolated from answers, and visible live to admins", async () => {
  const startRequestId = "51c6f357-6a62-4e93-b160-4aadef160010";
  const start = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    body: {
      startRequestId,
      participantId: "PG-2026-0001",
      participant: {
        fullName: "Test Participant",
        college: "Example College",
        email: "participant@example.test",
        phone: "+15555550123",
        department: "Security",
        year: "I Year"
      },
      round: 1,
      questionNumber: 1
    }
  });
  assert.equal(start.response.status, 201);
  assert.notEqual(start.result.quizSessionId, startRequestId);
  assert.match(start.result.quizSessionId, /^[\da-f-]{36}$/i);
  assert.match(start.result.participantId, /^PG-\d{4}-[A-F\d]{12}$/);
  participantCookie = cookieFrom(start.response);
  quizSessionId = start.result.quizSessionId;

  const blockedAttempt = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    body: { quizSessionId, attempt: participantAttempt() }
  });
  assert.equal(blockedAttempt.response.status, 401);
  const initialAttempt = participantAttempt();
  initialAttempt.questionIds = questionIds;
  initialAttempt.currentRound = 3;
  initialAttempt.currentQuestion = 9;
  initialAttempt.answers = questionIds.slice(0, 39).map((id, index) => ({
    questionId: id,
    round: answerKey[id].round,
    choice: [0, 15, 30].includes(index)
      ? (answerKey[id].answer === "phishing" ? "legitimate" : "phishing")
      : answerKey[id].answer
  }));
  const savedAttempt = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: participantCookie,
    body: { quizSessionId, attempt: initialAttempt }
  });
  assert.equal(savedAttempt.response.status, 200);
  assert.equal(savedAttempt.result.participantId, start.result.participantId);

  const params = { quizSessionId, round: 1, questionNumber: 4 };
  const hiddenEventId = "51c6f357-6a62-4e93-b160-4aadef160001";
  for (const eventType of ["TAB_HIDDEN", "WINDOW_BLUR", "RETURNED", "FULLSCREEN_EXIT"]) {
    const event = await jsonRequest("/api/monitor/events", {
      method: "POST",
      cookie: participantCookie,
      body: { ...params, eventType, ...(eventType === "TAB_HIDDEN" ? { clientEventId: hiddenEventId } : {}) }
    });
    assert.equal(event.response.status, 201);
    assert.ok(event.result.timestamp);
  }
  const repeatedEvent = await jsonRequest("/api/monitor/events", {
    method: "POST",
    cookie: participantCookie,
    body: { ...params, eventType: "TAB_HIDDEN", clientEventId: hiddenEventId }
  });
  assert.equal(repeatedEvent.response.status, 200);
  assert.equal(repeatedEvent.result.recorded, false);

  const participantRead = await jsonRequest("/api/admin/monitor/snapshot", { cookie: participantCookie });
  assert.equal(participantRead.response.status, 401);

  const adminRead = await jsonRequest("/api/admin/monitor/snapshot", { cookie: adminCookie });
  assert.equal(adminRead.response.status, 200);
  const attempt = adminRead.result.attempts.find(item => item.id === start.result.participantId);
  assert.ok(attempt);
  assert.equal(attempt.id, start.result.participantId);
  assert.equal(attempt.participant.fullName, "Test Participant");
  assert.equal(attempt.participant.college, "Example College");
  assert.equal(attempt.startedAt, start.result.timestamp);
  const participant = adminRead.result.participants.find(item => item.quizSessionId === quizSessionId);
  assert.equal(participant.tabSwitches, 1);
  assert.equal(participant.focusLosses, 1);
  assert.equal(participant.fullscreenExits, 1);
  assert.equal(participant.returns, 1);
  assert.equal(participant.round, 1);
  assert.equal(participant.questionNumber, 4);
  assert.equal(participant.phone, "+15555550123");
  assert.equal(participant.deviceType, "DESKTOP");
  assert.ok(participant.loginTime);
  assert.equal(adminRead.result.events[0].event_type, "FULLSCREEN_EXIT");
  assert.equal(adminRead.result.events.filter(event => event.event_type === "TAB_HIDDEN").length, 1);

  const spoof = await jsonRequest("/api/monitor/events", {
    method: "POST",
    cookie: participantCookie,
    body: { ...params, quizSessionId: "not-the-owned-session", eventType: "TAB_HIDDEN" }
  });
  assert.equal(spoof.response.status, 404);

  const backwards = await jsonRequest("/api/monitor/events", {
    method: "POST",
    cookie: participantCookie,
    body: { quizSessionId, round: 1, questionNumber: 2, eventType: "QUIZ_PROGRESS" }
  });
  assert.equal(backwards.response.status, 409);

  const incompleteAttempt = { ...initialAttempt };
  const incomplete = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: participantCookie,
    body: { quizSessionId, attempt: incompleteAttempt }
  });
  assert.equal(incomplete.response.status, 200);
  assert.equal(Object.hasOwn(incomplete.result, "review"), false);
  assert.equal(Object.hasOwn(incomplete.result, "score"), false);

  const partialCompletion = {
    ...incompleteAttempt,
    currentQuestion: 10,
    answers: questionIds.map((id, index) => ({
      questionId: id,
      round: answerKey[id].round,
      choice: [0, 15, 30].includes(index)
        ? (answerKey[id].answer === "phishing" ? "legitimate" : "phishing")
        : answerKey[id].answer
    })),
    status: "Completed",
    completedAt: new Date().toISOString()
  };
  const forged = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: participantCookie,
    body: { quizSessionId, attempt: { ...partialCompletion, answers: partialCompletion.answers.slice(0, 39) } }
  });
  assert.equal(forged.response.status, 400);

  const completed = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: participantCookie,
    body: { quizSessionId, attempt: partialCompletion }
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.result.score, 37);
  assert.deepEqual(completed.result.roundScores, { 1: 14, 2: 14, 3: 9 });
  assert.deepEqual(completed.result.review.map(item => item.round), [1, 2, 3]);
  assert.equal(completed.result.review.length, 3);
  assert.equal(completed.result.review[0].choice, partialCompletion.answers[0].choice);
  assert.equal(completed.result.review[0].correctAnswer, answerKey[questionIds[0]].answer);
  assert.equal(completed.result.review[0].explanation, answerKey[questionIds[0]].explanation);

  const revealedDuringQuiz = await jsonRequest("/api/practice/evaluate", {
    method: "POST",
    cookie: participantCookie,
    body: { questionId: questionIds[1], choice: answerKey[questionIds[1]].answer }
  });
  assert.equal(revealedDuringQuiz.response.status, 403);
});

test("a perfect 40/40 quiz completes with no incorrect-answer review", async () => {
  const start = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    body: {
      startRequestId: crypto.randomUUID(),
      participant: {
        fullName: "Perfect Score Participant",
        college: "Example College",
        email: "perfect@example.test",
        department: "Security",
        year: "I Year"
      },
      round: 1,
      questionNumber: 1
    }
  });
  assert.equal(start.response.status, 201);
  const ids = questionIds;
  const answers = ids.map(questionId => ({
    questionId,
    round: answerKey[questionId].round,
    choice: answerKey[questionId].answer
  }));
  const result = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: cookieFrom(start.response),
    body: {
      quizSessionId: start.result.quizSessionId,
      attempt: {
        ...participantAttempt("Perfect Score Participant"),
        id: start.result.participantId,
        questionIds: ids,
        answers,
        currentRound: 3,
        currentQuestion: 10,
        completedAt: new Date().toISOString(),
        status: "Completed"
      }
    }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.result.score, 40);
  assert.deepEqual(result.result.roundScores, { 1: 15, 2: 15, 3: 10 });
  assert.equal(result.result.accuracy, 100);
  assert.deepEqual(result.result.review, []);
  const resumed = await jsonRequest("/api/monitor/current", {
    cookie: cookieFrom(start.response)
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.result.attempt.status, "Completed");
  assert.equal(resumed.result.attempt.score, 40);
  assert.deepEqual(resumed.result.attempt.roundScores, { 1: 15, 2: 15, 3: 10 });
  assert.deepEqual(resumed.result.attempt.resultReview, []);
});

test("participant session restoration returns saved progress without exposing live scoring", async () => {
  const started = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    body: {
      startRequestId: crypto.randomUUID(),
      participant: {
        fullName: "Refresh Participant",
        college: "Example College",
        email: "refresh@example.test",
        department: "Security",
        year: "I Year"
      },
      round: 1,
      questionNumber: 1
    }
  });
  const cookie = cookieFrom(started.response);
  const first = {
    ...participantAttempt("Refresh Participant"),
    id: started.result.participantId
  };
  const savedStart = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie,
    body: { quizSessionId: started.result.quizSessionId, attempt: first }
  });
  assert.equal(savedStart.response.status, 200);

  const firstRestore = await jsonRequest("/api/monitor/current", { cookie });
  assert.equal(firstRestore.response.status, 200);
  assert.equal(firstRestore.result.quizSessionId, started.result.quizSessionId);
  assert.equal(firstRestore.result.participantId, started.result.participantId);
  assert.equal(firstRestore.result.attempt.currentRound, 1);
  assert.equal(firstRestore.result.attempt.currentQuestion, 0);
  assert.equal(Object.hasOwn(firstRestore.result.attempt, "score"), false);
  assert.equal(Object.hasOwn(firstRestore.result.attempt, "roundScores"), false);

  const skippedAhead = {
    ...first,
    answers: questionIds.slice(0, 2).map(questionId => ({
      questionId,
      round: 1,
      choice: answerKey[questionId].answer
    })),
    currentQuestion: 2
  };
  const rejectedJump = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie,
    body: { quizSessionId: started.result.quizSessionId, attempt: skippedAhead }
  });
  assert.equal(rejectedJump.response.status, 409);

  const answered = {
    ...first,
    answers: [{
      questionId: questionIds[0],
      round: 1,
      choice: answerKey[questionIds[0]].answer
    }],
    currentQuestion: 1
  };
  const savedAnswer = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie,
    body: { quizSessionId: started.result.quizSessionId, attempt: answered }
  });
  assert.equal(savedAnswer.response.status, 200);
  const afterAnswer = await jsonRequest("/api/monitor/current", { cookie });
  assert.equal(afterAnswer.result.attempt.currentQuestion, 1);
  assert.deepEqual(afterAnswer.result.attempt.answers, answered.answers);

  const wrongPosition = await jsonRequest(
    `/api/monitor/sessions/${started.result.quizSessionId}/resume`,
    { method: "POST", cookie, body: { round: 3, questionNumber: 1 } }
  );
  assert.equal(wrongPosition.response.status, 409);
  const correctPosition = await jsonRequest(
    `/api/monitor/sessions/${started.result.quizSessionId}/resume`,
    { method: "POST", cookie, body: { round: 1, questionNumber: 2 } }
  );
  assert.equal(correctPosition.response.status, 200);
});

test("RAPID FINAL eligibility is server-calculated at the exact 95 percent threshold", async () => {
  assert.equal(rapidFinalEligible({ status: "Completed", totalQuestions: 40, score: 38 }), true);
  assert.equal(rapidFinalEligible({ status: "Completed", totalQuestions: 40, score: 37 }), false);
  const qualifier = await completedParticipant("Ninety Five Percent", 38);
  const status = await jsonRequest("/api/rapid-final/status", { cookie: qualifier.cookie });
  assert.equal(status.response.status, 200);
  assert.equal(status.result.eligible, true);
  assert.equal(status.result.mainPercentage, 95);
  assert.equal(status.result.mainScore, 38);
  assert.deepEqual(status.result.mainRoundScores, { 1: 15, 2: 15, 3: 8 });
  assert.equal(status.result.mainReview.length, 2);
  assert.equal(status.result.mainReview.some(item => Object.hasOwn(item, "isCorrect")), false);
  assert.equal(status.result.status, "available");
  const rapid = await jsonRequest("/api/rapid-final/start", {
    method: "POST", cookie: qualifier.cookie, body: {}
  });
  assert.equal(rapid.result.status, "in_progress");
  const originalDeadline = rapid.result.deadlineAt;
  rapidNow += 5000;
  const refreshedRapid = await jsonRequest("/api/rapid-final/state", { cookie: qualifier.cookie });
  assert.equal(refreshedRapid.result.questionIndex, rapid.result.questionIndex);
  assert.equal(refreshedRapid.result.deadlineAt, originalDeadline);
  assert.equal(refreshedRapid.result.deadlineAt - refreshedRapid.result.serverNow, 15000);
  rapidNow += 15000;
  const expiredRapid = await jsonRequest("/api/rapid-final/state", { cookie: qualifier.cookie });
  assert.equal(expiredRapid.result.questionIndex, 1);
  assert.equal(expiredRapid.result.deadlineAt - expiredRapid.result.serverNow, 20000);
  const belowThreshold = await completedParticipant("Below Qualification", 37);
  const belowStatus = await jsonRequest("/api/rapid-final/status", { cookie: belowThreshold.cookie });
  assert.equal(belowStatus.response.status, 200);
  assert.equal(belowStatus.result.eligible, false);
  assert.equal(belowStatus.result.mainPercentage, 92.5);
  const blockedStart = await jsonRequest("/api/rapid-final/start", {
    method: "POST", cookie: belowThreshold.cookie, body: {}
  });
  assert.equal(blockedStart.response.status, 403);
  const blockedState = await jsonRequest("/api/rapid-final/state", { cookie: belowThreshold.cookie });
  assert.equal(blockedState.response.status, 403);
  const forgedClientScore = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: belowThreshold.cookie,
    body: {
      quizSessionId: belowThreshold.quizSessionId,
      attempt: {
        ...participantAttempt("Below Qualification"),
        id: belowThreshold.participantId,
        questionIds,
        answers: questionIds.map((questionId, index) => ({
          questionId,
          round: answerKey[questionId].round,
          choice: index < 37
            ? answerKey[questionId].answer
            : answerKey[questionId].answer === "phishing" ? "legitimate" : "phishing"
        })),
        currentRound: 3,
        currentQuestion: 10,
        status: "Completed",
        completedAt: belowThreshold.completedAt,
        score: 40,
        accuracy: 100
      }
    }
  });
  assert.equal(forgedClientScore.response.status, 200);
  assert.equal(forgedClientScore.result.score, 37);
  assert.equal(forgedClientScore.result.rapidFinalEligible, false);
});

test("RAPID FINAL serves five secret timed questions and records an admin-only result", async () => {
  const participant = await completedParticipant("Rapid Final Qualifier", 40);
  const started = await jsonRequest("/api/rapid-final/start", {
    method: "POST", cookie: participant.cookie, body: {}
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.result.status, "in_progress");
  assert.equal(started.result.questionCount, 5);
  assert.equal(started.result.secondsPerQuestion, 20);
  assert.equal(started.result.deadlineAt - started.result.questionStartedAt, 20000);
  assert.equal(started.result.question.options.length, 4);
  assert.equal(Object.hasOwn(started.result.question, "answer"), false);
  assert.equal(Object.hasOwn(started.result.question, "explanation"), false);
  assert.equal(Object.hasOwn(started.result, "score"), false);
  assert.equal(rapidFinalQuestions.length, 5);
  assert.equal(new Set(rapidFinalQuestions.map(question => question.id)).size, 5);
  for (const question of rapidFinalQuestions) {
    assert.equal(question.options.length, 4);
    assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4);
    assert.ok(question.explanation.length > 20);
  }

  let state = started.result;
  for (let index = 0; index < 5; index++) {
    assert.equal(state.questionIndex, index);
    const requestId = crypto.randomUUID();
    const submission = await jsonRequest("/api/rapid-final/answer", {
      method: "POST",
      cookie: participant.cookie,
      body: {
        questionIndex: index,
        choiceIndex: rapidFinalQuestions[index].answer,
        requestId
      }
    });
    assert.equal(submission.response.status, 200);
    state = submission.result;
    assert.equal(Object.hasOwn(state, "answers"), false);
    assert.equal(Object.hasOwn(state, "correctAnswer"), false);
    assert.equal(Object.hasOwn(state, "isCorrect"), false);
    if (index < 4) assert.equal(Object.hasOwn(state, "score"), false);
    if (index === 0) {
      const duplicate = await jsonRequest("/api/rapid-final/answer", {
        method: "POST",
        cookie: participant.cookie,
        body: { questionIndex: index, choiceIndex: 0, requestId }
      });
      assert.equal(duplicate.response.status, 200);
      assert.equal(duplicate.result.questionIndex, 1);
    }
  }
  assert.equal(state.status, "completed");
  assert.equal(state.score, 5);
  const replay = await jsonRequest("/api/rapid-final/answer", {
    method: "POST",
    cookie: participant.cookie,
    body: { questionIndex: 4, choiceIndex: 0, requestId: crypto.randomUUID() }
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.result.score, 5);
  const reentered = await jsonRequest("/api/rapid-final/start", {
    method: "POST", cookie: participant.cookie, body: {}
  });
  assert.equal(reentered.result.status, "completed");
  assert.equal(reentered.result.score, 5);
  const participantAdminData = await jsonRequest("/api/admin/monitor/snapshot", {
    cookie: participant.cookie
  });
  assert.equal(participantAdminData.response.status, 401);
  const snapshot = await jsonRequest("/api/admin/monitor/snapshot", { cookie: adminCookie });
  const record = snapshot.result.attempts.find(item => item.id === participant.participantId);
  assert.equal(record.rapidFinal.eligible, true);
  assert.equal(record.rapidFinal.score, 5);
  assert.equal(record.rapidFinal.answers.length, 5);
  assert.equal(record.rapidFinal.answers[0].correctAnswer, rapidFinalQuestions[0].answer);
  assert.equal(record.rapidFinal.answers[0].isCorrect, true);
  assert.ok(Number.isFinite(record.rapidFinal.answers[0].submittedAt));
  assert.equal(record.rapidFinal.unansweredCount, 0);
  assert.equal(record.rapidFinal.ranking, 1);
});

test("RAPID FINAL timeout advances from server time and scores unanswered as zero", async () => {
  const participant = await completedParticipant("Rapid Timeout Qualifier", 39);
  const started = await jsonRequest("/api/rapid-final/start", {
    method: "POST", cookie: participant.cookie, body: {}
  });
  assert.equal(started.response.status, 200);
  rapidNow = started.result.deadlineAt + 1;
  const afterExpiry = await jsonRequest("/api/rapid-final/answer", {
    method: "POST",
    cookie: participant.cookie,
    body: {
      questionIndex: 0,
      choiceIndex: rapidFinalQuestions[0].answer,
      requestId: crypto.randomUUID()
    }
  });
  assert.equal(afterExpiry.response.status, 409);
  assert.equal(afterExpiry.result.state.questionIndex, 1);
  assert.equal(afterExpiry.result.state.question.id, rapidFinalQuestions[1].id);
  let state = afterExpiry.result.state;
  for (let index = 1; index < 5; index++) {
    const next = await jsonRequest("/api/rapid-final/answer", {
      method: "POST",
      cookie: participant.cookie,
      body: {
        questionIndex: index,
        choiceIndex: rapidFinalQuestions[index].answer,
        requestId: crypto.randomUUID()
      }
    });
    assert.equal(next.response.status, 200);
    state = next.result;
  }
  assert.equal(state.status, "completed");
  assert.equal(state.score, 4);
  const snapshot = await jsonRequest("/api/admin/monitor/snapshot", { cookie: adminCookie });
  const record = snapshot.result.attempts.find(item => item.id === participant.participantId);
  assert.equal(record.rapidFinal.unansweredCount, 1);
  assert.equal(record.rapidFinal.answers[0].choiceIndex, null);
  assert.equal(record.rapidFinal.answers[0].isCorrect, false);
  assert.equal(record.rapidFinal.answers[0].responseTimeMs, 20000);
});

test("RAPID FINAL ranking uses score, correct response time, and explicit ties", () => {
  const makeRecord = (id, score, responseTime) => ({
    id,
    rapidFinal: {
      eligible: true,
      status: "completed",
      score,
      totalCorrectResponseMs: responseTime,
      ranking: null,
      isTied: false
    }
  });
  const ranked = rankRapidFinal([
    makeRecord("tie-a", 5, 900),
    makeRecord("tie-b", 5, 900),
    makeRecord("slower-five", 5, 600),
    makeRecord("fastest-five", 5, 500),
    makeRecord("faster-lower", 4, 100)
  ]);
  assert.deepEqual(ranked.map(record => [record.id, record.rapidFinal.ranking, record.rapidFinal.isTied]), [
    ["tie-a", 3, true],
    ["tie-b", 3, true],
    ["slower-five", 2, false],
    ["fastest-five", 1, false],
    ["faster-lower", 5, false]
  ]);
});

test("admin event stream publishes independent participant sessions and updated progress", async t => {
  const response = await fetch(`${baseUrl}/api/admin/monitor/stream`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  const initialSnapshot = await readUntil(reader, "Test Participant");
  assert.match(initialSnapshot, /"type":"snapshot"/);
  assert.match(initialSnapshot, /Test Participant/);

  const retryableSessionId = "51c6f357-6a62-4e93-b160-4aadef160002";
  const participantStart = {
    startRequestId: retryableSessionId,
    participantId: "PG-2026-0002",
    participant: {
      fullName: "Mobile Participant",
      college: "Example College",
      email: "mobile@example.test",
      department: "Security",
      year: "I Year"
    },
    round: 1,
    questionNumber: 1
  };
  const mobileStart = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    body: participantStart,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"
  });
  assert.equal(mobileStart.response.status, 201);
  assert.notEqual(mobileStart.result.quizSessionId, retryableSessionId);
  const snapshotAfterStart = await jsonRequest("/api/admin/monitor/snapshot", { cookie: adminCookie });
  const mobileParticipant = snapshotAfterStart.result.participants.find(item =>
    item.quizSessionId === mobileStart.result.quizSessionId);
  assert.equal(mobileParticipant.deviceType, "MOBILE");
  const mobileCookie = cookieFrom(mobileStart.response);
  const liveText = await readUntil(reader, "Mobile Participant");
  assert.match(liveText, /Mobile Participant/);
  assert.match(liveText, /"type":"upsert"/);
  assert.match(liveText, /"deviceType":"MOBILE"/);
  assert.match(liveText, /"loginTime":/);

  const mobileAttempt = await jsonRequest("/api/monitor/attempts", {
    method: "POST",
    cookie: mobileCookie,
    body: { quizSessionId: mobileStart.result.quizSessionId, attempt: participantAttempt("Mobile Participant") }
  });
  assert.equal(mobileAttempt.response.status, 200);
  const attemptUpdate = await readUntil(reader, '"type":"attempt-upsert"');
  assert.match(attemptUpdate, new RegExp(mobileStart.result.participantId));

  const progress = await jsonRequest("/api/monitor/events", {
    method: "POST",
    cookie: mobileCookie,
    body: {
      quizSessionId: mobileStart.result.quizSessionId,
      round: 1,
      questionNumber: 2,
      eventType: "QUIZ_PROGRESS"
    }
  });
  assert.equal(progress.response.status, 201);
  const progressUpdate = await readUntil(reader, '"questionNumber":2');
  assert.match(progressUpdate, /"type":"upsert"/);
  assert.match(progressUpdate, /"questionNumber":2/);

  for (let index = 1; index <= 8; index++) {
    const name = `Global Participant ${index}`;
    const startRequestId = crypto.randomUUID();
    const participantStart = await jsonRequest("/api/monitor/sessions", {
      method: "POST",
      body: {
        startRequestId,
        participant: {
          fullName: name,
          college: "Example College",
          email: `global-${index}@example.test`,
          phone: "",
          department: "Security",
          year: "I Year"
        },
        round: 1,
        questionNumber: 1
      },
      userAgent: index % 2
        ? "Mozilla/5.0 (Linux; Android 15; Mobile)"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    });
    assert.equal(participantStart.response.status, 201);
    const independentCookie = cookieFrom(participantStart.response);
    const sessionUpdate = await readUntil(reader, name);
    assert.match(sessionUpdate, /"type":"upsert"/);

    const record = await jsonRequest("/api/monitor/attempts", {
      method: "POST",
      cookie: independentCookie,
      body: {
        quizSessionId: participantStart.result.quizSessionId,
        attempt: participantAttempt(name)
      }
    });
    assert.equal(record.response.status, 200);
    const recordUpdate = await readUntil(reader, '"type":"attempt-upsert"');
    assert.match(recordUpdate, new RegExp(participantStart.result.participantId));
  }

  const retriedStart = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    cookie: mobileCookie,
    body: participantStart
  });
  assert.equal(retriedStart.response.status, 200);
  assert.equal(retriedStart.result.quizSessionId, mobileStart.result.quizSessionId);
  assert.equal(retriedStart.result.participantId, mobileStart.result.participantId);
  const snapshot = await jsonRequest("/api/admin/monitor/snapshot", { cookie: adminCookie });
  assert.ok(snapshot.result.participants.length >= 11);
  assert.ok(snapshot.result.attempts.length >= 11);
  for (let index = 1; index <= 8; index++) {
    assert.ok(snapshot.result.participants.some(person => person.participantName === `Global Participant ${index}`));
  }

  await reader.cancel();
  const reconnected = await fetch(`${baseUrl}/api/admin/monitor/stream`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(reconnected.status, 200);
  const reconnectedReader = reconnected.body.getReader();
  t.after(() => reconnectedReader.cancel().catch(() => {}));
  const reconnectText = await readUntil(reconnectedReader, "Mobile Participant");
  assert.match(reconnectText, /"type":"snapshot"/);
  assert.match(reconnectText, /Mobile Participant/);
  const closed = reconnectedReader.read();
  await jsonRequest("/api/admin/logout", {
    method: "POST",
    body: {},
    cookie: adminCookie
  });
  let closedState = await closed;
  while (!closedState.done) closedState = await reconnectedReader.read();
  await reconnectedReader.cancel();
});

test("private monitoring database and server configuration are not static assets", async () => {
  for (const asset of [
    "/server.js", "/package.json", "/data/monitor.sqlite",
    "/private/quiz-answer-key.json", "/private/rapid-final-questions.json", "/js/admin-config.js"
  ]) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 404, `${asset} should not be publicly served`);
  }
});

test("health endpoint identifies one shared backend process without authentication", async () => {
  const first = await jsonRequest("/api/health");
  const second = await jsonRequest("/api/health");
  assert.equal(first.response.status, 200);
  assert.equal(first.result.status, "ok");
  assert.match(first.result.backendInstanceId, /^[\da-f-]{36}$/i);
  assert.equal(second.result.backendInstanceId, first.result.backendInstanceId);
});

function loadMonitoringService(fetch) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const storage = new Map();
  const timerCleanup = [];
  const document = {
    visibilityState: "visible",
    fullscreenElement: {},
    hasFocus: () => true,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    }
  };
  const window = {
    crypto: crypto.webcrypto,
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay);
      timerCleanup.push(() => clearTimeout(timer));
      return timer;
    },
    clearTimeout,
    setInterval(callback, delay) {
      const timer = setInterval(callback, delay);
      timerCleanup.push(() => clearInterval(timer));
      return timer;
    },
    clearInterval,
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    dispatch(type) {
      for (const listener of windowListeners.get(type) || []) listener();
    },
    PGQuizService: { roundSize: () => 10 }
  };
  const sessionStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const context = vm.createContext({
    window,
    document,
    sessionStorage,
    fetch,
    AbortController,
    Uint8Array,
    clearTimeout,
    clearInterval,
    console: { error() {} }
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "monitoring-service.js"), "utf8");
  vm.runInContext(source, context);
  return {
    service: window.PGMonitoringService,
    cleanup: () => timerCleanup.forEach(clear => clear()),
    document,
    documentListeners,
    sessionStorage,
    window
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

test("participant monitoring retries transient start and event failures without duplicate IDs", async t => {
  let failSessionStart = true;
  let failFirstEvent = true;
  const starts = [];
  const events = [];
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/resume")) {
      return { ok: false, status: 404, json: async () => ({ error: "Active quiz monitoring session was not found." }) };
    }
    if (url.endsWith("/sessions")) {
      starts.push(body);
      if (failSessionStart) {
        failSessionStart = false;
        throw new TypeError("Network unavailable");
      }
      return { ok: true, status: 201, json: async () => ({
        quizSessionId: "787393d5-af8c-4d2c-b591-6c1879f09501",
        participantId: "PG-2026-0001"
      }) };
    }
    if (url.endsWith("/attempts")) {
      return { ok: true, status: 200, json: async () => ({
        participantId: "PG-2026-0001",
        score: 40,
        roundScores: { 1: 15, 2: 15, 3: 10 },
        accuracy: 100,
        review: []
      }) };
    }
    assert.ok(url.endsWith("/events"), `Unexpected monitoring request: ${url}`);
    events.push(body);
    if (failFirstEvent) {
      failFirstEvent = false;
      throw new TypeError("Network unavailable");
    }
    return { ok: true, status: 201, json: async () => ({ recorded: true }) };
  };
  const { service, cleanup, document, documentListeners, sessionStorage, window } = loadMonitoringService(fakeFetch);
  t.after(cleanup);
  const syncStatuses = [];
  service.setStatusHandler(error => syncStatuses.push(error ? error.message : "connected"));
  const attempt = {
    id: "PG-2026-0001",
    status: "In Progress",
    currentRound: 1,
    currentQuestion: 0,
    participant: {
      fullName: "Test Participant",
      college: "Example College",
      email: "participant@example.test",
      department: "Security",
      year: "I Year"
    }
  };

  await service.start(attempt);
  assert.equal(starts.length, 1);
  const startRequestId = starts[0].startRequestId;
  assert.match(startRequestId, /^[\da-f-]{36}$/i);
  window.dispatch("online");
  await waitFor(() => starts.length === 2 && events.length >= 2, "Monitoring did not recover after connectivity returned.");
  assert.equal(starts[1].startRequestId, startRequestId);
  assert.equal(events[1].quizSessionId, "787393d5-af8c-4d2c-b591-6c1879f09501");
  assert.equal(events[0].clientEventId, events[1].clientEventId);
  assert.equal(events[1].quizSessionId, "787393d5-af8c-4d2c-b591-6c1879f09501");
  assert.ok(syncStatuses.includes("Network unavailable"));
  assert.equal(syncStatuses.at(-1), "connected");

  document.fullscreenElement = null;
  for (const listener of documentListeners.get("fullscreenchange") || []) listener();
  await waitFor(() => events.some(event => event.eventType === "FULLSCREEN_EXIT"), "Fullscreen change was not reported.");
  await service.finish(attempt);
  assert.ok(events.some(event => event.eventType === "QUIZ_COMPLETED"));
  assert.equal(sessionStorage.getItem("phishguard.monitor.session.v1"), null);
});
