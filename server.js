"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const Database = require("better-sqlite3");
const express = require("express");
const session = require("express-session");
const QUIZ_ANSWER_KEY = require("./private/quiz-answer-key.json");
const RAPID_FINAL_QUESTIONS = require("./private/rapid-final-questions.json");

const ROOT = __dirname;
const SESSION_NAME = "phishguard.sid";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 45 * 1000;
const ACTIVE_WINDOW_MS = 8 * 60 * 60 * 1000;
const ROUND_SIZES = Object.freeze([15, 15, 10]);
const TOTAL_QUESTIONS = ROUND_SIZES.reduce((sum, size) => sum + size, 0);
const RAPID_FINAL_QUESTION_COUNT = 5;
const RAPID_FINAL_SECONDS_PER_QUESTION = 20;
const RAPID_FINAL_QUESTION_MS = RAPID_FINAL_SECONDS_PER_QUESTION * 1000;
function participantMainReview(attempt) {
  return attempt.resultReview.filter(item => !item.isCorrect).map(item => ({
    questionId: item.questionId,
    round: item.round,
    choice: item.choice,
    correctAnswer: item.correctAnswer,
    explanation: item.explanation
  }));
}
const ALLOWED_EVENTS = new Set([
  "TAB_HIDDEN", "WINDOW_BLUR", "RETURNED", "FULLSCREEN_EXIT",
  "QUIZ_PROGRESS", "PAGE_HIDDEN", "QUIZ_COMPLETED"
]);

function serverTimestamp() {
  return new Date().toISOString();
}

function safeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function verifyAdminPassword(password, passwordHash) {
  const [scheme, saltHex, keyHex] = passwordHash.split("$");
  if (scheme !== "scrypt" || !/^[\da-f]{32}$/i.test(saltHex || "") ||
      !/^[\da-f]{128}$/i.test(keyHex || "")) {
    throw new Error("PHISHGUARD_ADMIN_PASSWORD_HASH must use the scrypt$<32-hex-salt>$<128-hex-key> format.");
  }
  const expected = Buffer.from(keyHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function isText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function parseRoundQuestion(body) {
  const round = Number(body.round);
  const questionNumber = Number(body.questionNumber);
  if (!Number.isInteger(round) || round < 1 || round > 3 ||
      !Number.isInteger(questionNumber) || questionNumber < 1 ||
      questionNumber > ROUND_SIZES[round - 1]) return null;
  return { round, questionNumber };
}

function normalizeAttempt(attempt, row) {
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt) ||
      !Array.isArray(attempt.questionIds) || attempt.questionIds.length !== TOTAL_QUESTIONS ||
      !attempt.questionIds.every(id => isText(id, 80)) ||
      new Set(attempt.questionIds).size !== TOTAL_QUESTIONS ||
      !Array.isArray(attempt.answers) || attempt.answers.length > TOTAL_QUESTIONS ||
      !Number.isInteger(attempt.currentRound) || attempt.currentRound < 1 || attempt.currentRound > 3 ||
      !Number.isInteger(attempt.currentQuestion) || attempt.currentQuestion < 0 ||
      attempt.currentQuestion > ROUND_SIZES[attempt.currentRound - 1] ||
      attempt.totalQuestions !== TOTAL_QUESTIONS ||
      !["In Progress", "Completed"].includes(attempt.status)) {
    return null;
  }
  const roundStarts = [0, ROUND_SIZES[0], ROUND_SIZES[0] + ROUND_SIZES[1]];
  for (let index = 0; index < attempt.questionIds.length; index++) {
    const question = QUIZ_ANSWER_KEY[attempt.questionIds[index]];
    const expectedRound = index < ROUND_SIZES[0] ? 1 : index < roundStarts[2] ? 2 : 3;
    if (!question || question.round !== expectedRound) return null;
  }
  const answerIds = new Set();
  for (const [answerIndex, answer] of attempt.answers.entries()) {
    if (!answer || !attempt.questionIds.includes(answer.questionId) ||
        answerIds.has(answer.questionId) ||
        attempt.questionIds[answerIndex] !== answer.questionId ||
        ![1, 2, 3].includes(answer.round) ||
        !["legitimate", "phishing"].includes(answer.choice) ||
        QUIZ_ANSWER_KEY[answer.questionId].round !== answer.round) return null;
    answerIds.add(answer.questionId);
  }
  const expectedAnswers = roundStarts[attempt.currentRound - 1] + attempt.currentQuestion;
  if (attempt.answers.length !== expectedAnswers) return null;
  if (attempt.status === "Completed" &&
      (attempt.currentRound !== 3 || attempt.currentQuestion !== ROUND_SIZES[2] ||
       attempt.answers.length !== TOTAL_QUESTIONS || !isText(attempt.completedAt, 40) ||
       Number.isNaN(Date.parse(attempt.completedAt)))) return null;

  const roundScores = { 1: 0, 2: 0, 3: 0 };
  for (const answer of attempt.answers) {
    if (QUIZ_ANSWER_KEY[answer.questionId].answer === answer.choice) roundScores[answer.round]++;
  }
  const score = Object.values(roundScores).reduce((sum, value) => sum + value, 0);
  const answersById = new Map(attempt.answers.map(answer => [answer.questionId, answer]));
  const resultReview = attempt.status === "Completed"
    ? attempt.questionIds.map(questionId => {
      const key = QUIZ_ANSWER_KEY[questionId];
      const answer = answersById.get(questionId);
      return {
        questionId,
        round: key.round,
        choice: answer.choice,
        correctAnswer: key.answer,
        isCorrect: answer.choice === key.answer,
        explanation: key.explanation
      };
    })
    : [];
  return {
    id: row.participant_id,
    participant: {
      fullName: row.participant_name,
      college: row.college,
      email: row.email,
      phone: row.phone,
      department: row.department,
      year: row.year
    },
    startedAt: row.created_at,
    completedAt: attempt.status === "Completed" ? attempt.completedAt : null,
    status: attempt.status,
    questionIds: attempt.questionIds,
    answers: attempt.answers,
    currentRound: attempt.currentRound,
    currentQuestion: attempt.currentQuestion,
    totalQuestions: TOTAL_QUESTIONS,
    roundScores,
    score,
    accuracy: attempt.status === "Completed" ? Math.round(score / TOTAL_QUESTIONS * 100) : null,
    resultReview
  };
}

function rapidFinalEligible(attempt) {
  return Boolean(attempt && attempt.status === "Completed" &&
    Number.isInteger(attempt.score) && attempt.totalQuestions === TOTAL_QUESTIONS &&
    attempt.score / TOTAL_QUESTIONS >= 0.95);
}

function rapidFinalPublicState(record, now = Date.now()) {
  if (!record) return { status: "not_started" };
  if (record.status === "completed") {
    return {
      status: "completed",
      score: record.score,
      completedAt: record.completedAt
    };
  }
  const questionIndex = record.questionIndex ?? record.question_index;
  const questionStartedAt = record.questionStartedAt ?? record.question_started_at;
  return {
    status: "in_progress",
    questionIndex,
    questionCount: RAPID_FINAL_QUESTION_COUNT,
    secondsPerQuestion: RAPID_FINAL_SECONDS_PER_QUESTION,
    questionStartedAt,
    deadlineAt: questionStartedAt + RAPID_FINAL_QUESTION_MS,
    serverNow: now,
    question: RAPID_FINAL_QUESTIONS[questionIndex]
      ? {
        id: RAPID_FINAL_QUESTIONS[questionIndex].id,
        title: RAPID_FINAL_QUESTIONS[questionIndex].title,
        scenario: RAPID_FINAL_QUESTIONS[questionIndex].scenario,
        options: RAPID_FINAL_QUESTIONS[questionIndex].options
      }
      : null
  };
}

function rapidFinalAdminView(record) {
  if (!record) return { status: "not_attempted", score: null, ranking: null };
  const answers = JSON.parse(record.answers_json);
  return {
    status: record.status,
    score: record.status === "completed" ? record.score : null,
    startedAt: record.started_at,
    completedAt: record.completed_at,
    totalCorrectResponseMs: record.total_correct_response_ms,
    unansweredCount: answers.filter(answer => answer.choiceIndex === null).length,
    answers: answers.map(answer => {
      const question = RAPID_FINAL_QUESTIONS.find(item => item.id === answer.questionId);
      return {
        ...answer,
        question: question ? question.scenario : "",
        title: question ? question.title : answer.questionId,
        options: question ? question.options : [],
        correctAnswer: question ? question.answer : null,
        explanation: question ? question.explanation : ""
      };
    })
  };
}

function rankRapidFinal(records) {
  const ranked = records.filter(record => record.rapidFinal.eligible &&
    record.rapidFinal.status === "completed")
    .sort((left, right) => right.rapidFinal.score - left.rapidFinal.score ||
      left.rapidFinal.totalCorrectResponseMs - right.rapidFinal.totalCorrectResponseMs);
  let rank = 0;
  for (let index = 0; index < ranked.length; index++) {
    const current = ranked[index].rapidFinal;
    const previous = ranked[index - 1]?.rapidFinal;
    if (!previous || current.score !== previous.score ||
        current.totalCorrectResponseMs !== previous.totalCorrectResponseMs) rank = index + 1;
    current.ranking = rank;
    current.isTied = Boolean(previous && current.score === previous.score &&
      current.totalCorrectResponseMs === previous.totalCorrectResponseMs) ||
      Boolean(ranked[index + 1] &&
        current.score === ranked[index + 1].rapidFinal.score &&
        current.totalCorrectResponseMs === ranked[index + 1].rapidFinal.totalCorrectResponseMs);
  }
  return records;
}

function deviceType(userAgent = "") {
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return "TABLET";
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return "MOBILE";
  if (userAgent) return "DESKTOP";
  return "UNKNOWN";
}

function createDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires);
    CREATE TABLE IF NOT EXISTS quiz_monitor_sessions (
      quiz_session_id TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL,
      client_start_id TEXT,
      participant_name TEXT NOT NULL,
      college TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL,
      year TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'UNKNOWN',
      owner_sid TEXT NOT NULL,
      current_round INTEGER NOT NULL DEFAULT 1,
      current_question INTEGER NOT NULL DEFAULT 1,
      current_state TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      last_event TEXT NOT NULL,
      inactive_since TEXT,
      tab_switches INTEGER NOT NULL DEFAULT 0,
      focus_losses INTEGER NOT NULL DEFAULT 0,
      fullscreen_exits INTEGER NOT NULL DEFAULT 0,
      returns INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS monitor_sessions_state
      ON quiz_monitor_sessions(current_state, last_activity);
    CREATE TABLE IF NOT EXISTS quiz_monitor_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id TEXT NOT NULL,
      participant_name TEXT NOT NULL,
      quiz_session_id TEXT NOT NULL REFERENCES quiz_monitor_sessions(quiz_session_id),
      round INTEGER NOT NULL,
      question_number INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration_seconds INTEGER,
      client_event_id TEXT
    );
    CREATE INDEX IF NOT EXISTS monitor_events_recent
      ON quiz_monitor_events(timestamp DESC);
    CREATE TABLE IF NOT EXISTS participant_attempts (
      quiz_session_id TEXT PRIMARY KEY REFERENCES quiz_monitor_sessions(quiz_session_id),
      participant_id TEXT NOT NULL UNIQUE,
      attempt_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS participant_attempts_updated
      ON participant_attempts(updated_at DESC);
    CREATE TABLE IF NOT EXISTS rapid_final_attempts (
      quiz_session_id TEXT PRIMARY KEY REFERENCES quiz_monitor_sessions(quiz_session_id),
      participant_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed')),
      question_index INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      question_started_at INTEGER NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]',
      completed_at INTEGER,
      score INTEGER,
      total_correct_response_ms INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rapid_final_ranking
      ON rapid_final_attempts(status, score DESC, total_correct_response_ms ASC);
  `);
  const sessionColumns = db.pragma("table_info(quiz_monitor_sessions)");
  if (!sessionColumns.some(column => column.name === "client_start_id")) {
    db.exec("ALTER TABLE quiz_monitor_sessions ADD COLUMN client_start_id TEXT");
  }
  if (!sessionColumns.some(column => column.name === "phone")) {
    db.exec("ALTER TABLE quiz_monitor_sessions ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
  if (!sessionColumns.some(column => column.name === "device_type")) {
    db.exec("ALTER TABLE quiz_monitor_sessions ADD COLUMN device_type TEXT NOT NULL DEFAULT 'UNKNOWN'");
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS monitor_sessions_client_start
    ON quiz_monitor_sessions(client_start_id) WHERE client_start_id IS NOT NULL`);
  const eventColumns = db.pragma("table_info(quiz_monitor_events)");
  if (!eventColumns.some(column => column.name === "client_event_id")) {
    db.exec("ALTER TABLE quiz_monitor_events ADD COLUMN client_event_id TEXT");
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS monitor_events_client_id
    ON quiz_monitor_events(client_event_id) WHERE client_event_id IS NOT NULL`);
  return db;
}

function createSessionStore(db) {
  const Store = session.Store;
  return new (class SQLiteSessionStore extends Store {
    constructor() {
      super();
      this.read = db.prepare("SELECT sess, expires FROM web_sessions WHERE sid = ?");
      this.write = db.prepare(`
        INSERT INTO web_sessions (sid, sess, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
      `);
      this.remove = db.prepare("DELETE FROM web_sessions WHERE sid = ?");
      this.purge = db.prepare("DELETE FROM web_sessions WHERE expires <= ?");
      this.expiry = db.prepare("UPDATE web_sessions SET expires = ? WHERE sid = ?");
      this.purge.run(Date.now());
    }

    get(sid, callback) {
      try {
        const row = this.read.get(sid);
        if (!row || row.expires <= Date.now()) {
          if (row) this.remove.run(sid);
          return callback(null, null);
        }
        callback(null, JSON.parse(row.sess));
      } catch (error) {
        callback(error);
      }
    }

    set(sid, value, callback) {
      try {
        const expires = value.cookie && value.cookie.expires
          ? new Date(value.cookie.expires).getTime()
          : Date.now() + SESSION_MAX_AGE;
        this.write.run(sid, JSON.stringify(value), expires);
        if (callback) callback(null);
      } catch (error) {
        if (callback) callback(error);
        else this.emit("disconnect", error);
      }
    }

    touch(sid, value, callback) {
      try {
        const expires = value.cookie && value.cookie.expires
          ? new Date(value.cookie.expires).getTime()
          : Date.now() + SESSION_MAX_AGE;
        this.expiry.run(expires, sid);
        if (callback) callback(null);
      } catch (error) {
        if (callback) callback(error);
        else this.emit("disconnect", error);
      }
    }

    destroy(sid, callback) {
      try {
        this.remove.run(sid);
        if (callback) callback(null);
      } catch (error) {
        if (callback) callback(error);
      }
    }
  })();
}

function createApp(options = {}) {
  const adminId = options.adminId || process.env.PHISHGUARD_ADMIN_ID;
  const adminPasswordHash = options.adminPasswordHash || process.env.PHISHGUARD_ADMIN_PASSWORD_HASH;
  const sessionSecret = options.sessionSecret || process.env.PHISHGUARD_SESSION_SECRET;
  const rapidFinalClock = options.rapidFinalClock || Date.now;
  if (!adminId || !adminPasswordHash) {
    throw new Error("Set PHISHGUARD_ADMIN_ID and PHISHGUARD_ADMIN_PASSWORD_HASH.");
  }
  verifyAdminPassword("", adminPasswordHash);
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("Set PHISHGUARD_SESSION_SECRET to a random value of at least 32 characters.");
  }

  const db = createDatabase(options.dbPath || path.join(ROOT, "data", "phishguard.sqlite"));
  const app = express();
  const sessionStore = createSessionStore(db);
  const statements = {
    insertSession: db.prepare(`
      INSERT INTO quiz_monitor_sessions (
        quiz_session_id, participant_id, client_start_id, participant_name, college, email, phone, department, year,
        device_type,
        owner_sid, current_round, current_question, current_state, created_at, updated_at,
        last_activity, last_event
      ) VALUES (
        @quizSessionId, @participantId, @clientStartId, @participantName, @college, @email, @phone, @department, @year,
        @deviceType,
        @ownerSid, @round, @questionNumber, 'ACTIVE', @timestamp, @timestamp, @timestamp, @eventType
      )
    `),
    findStartRequest: db.prepare("SELECT * FROM quiz_monitor_sessions WHERE client_start_id = ?"),
    findOwnedSession: db.prepare(`
      SELECT * FROM quiz_monitor_sessions WHERE quiz_session_id = ? AND owner_sid = ?
    `),
    getSession: db.prepare("SELECT * FROM quiz_monitor_sessions WHERE quiz_session_id = ?"),
    updateSession: db.prepare(`
      UPDATE quiz_monitor_sessions SET current_round = @round, current_question = @questionNumber,
        current_state = @state, updated_at = @timestamp, last_activity = @timestamp,
        last_event = @eventType, inactive_since = @inactiveSince,
        tab_switches = @tabSwitches, focus_losses = @focusLosses,
        fullscreen_exits = @fullscreenExits, returns = @returns
      WHERE quiz_session_id = @quizSessionId
    `),
    insertEvent: db.prepare(`
      INSERT INTO quiz_monitor_events (
        participant_id, participant_name, quiz_session_id, round, question_number,
        event_type, timestamp, duration_seconds, client_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    findClientEvent: db.prepare(`
      SELECT timestamp FROM quiz_monitor_events WHERE client_event_id = ?
    `),
    activeSessions: db.prepare(`
      SELECT * FROM quiz_monitor_sessions
      WHERE current_state != 'COMPLETED' AND created_at >= ?
      ORDER BY last_activity DESC
    `),
    recentEvents: db.prepare(`
      SELECT event_id, participant_id, participant_name, quiz_session_id, round, question_number,
        event_type, timestamp, duration_seconds
      FROM quiz_monitor_events WHERE timestamp >= ? AND event_type != 'QUIZ_PROGRESS'
      ORDER BY event_id DESC LIMIT 50
    `),
    updateOwner: db.prepare(`
      UPDATE quiz_monitor_sessions SET owner_sid = ? WHERE quiz_session_id = ?
    `),
    saveAttempt: db.prepare(`
      INSERT INTO participant_attempts (quiz_session_id, participant_id, attempt_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(quiz_session_id) DO UPDATE SET
        attempt_json = excluded.attempt_json, updated_at = excluded.updated_at
    `),
    getAttempt: db.prepare("SELECT attempt_json FROM participant_attempts WHERE quiz_session_id = ?"),
    allAttempts: db.prepare(`
      SELECT quiz_session_id, attempt_json FROM participant_attempts ORDER BY updated_at DESC
    `),
    latestOwnedAttempt: db.prepare(`
      SELECT s.quiz_session_id, a.attempt_json
      FROM quiz_monitor_sessions s
      JOIN participant_attempts a ON a.quiz_session_id = s.quiz_session_id
      WHERE s.owner_sid = ?
      ORDER BY s.created_at DESC LIMIT 1
    `),
    rapidForSession: db.prepare("SELECT * FROM rapid_final_attempts WHERE quiz_session_id = ?"),
    allRapidFinalAttempts: db.prepare("SELECT * FROM rapid_final_attempts"),
    insertRapidFinalAttempt: db.prepare(`
      INSERT OR IGNORE INTO rapid_final_attempts (
        quiz_session_id, participant_id, status, question_index, started_at,
        question_started_at, answers_json, updated_at
      ) VALUES (?, ?, 'in_progress', 0, ?, ?, '[]', ?)
    `),
    updateRapidFinalAttempt: db.prepare(`
      UPDATE rapid_final_attempts SET status = @status, question_index = @questionIndex,
        question_started_at = @questionStartedAt, answers_json = @answersJson,
        completed_at = @completedAt, score = @score,
        total_correct_response_ms = @totalCorrectResponseMs, updated_at = @updatedAt
      WHERE quiz_session_id = @quizSessionId AND status = 'in_progress'
        AND question_index = @expectedQuestionIndex
        AND question_started_at = @expectedQuestionStartedAt
    `)
  };
  const adminStreams = new Map();
  const staleTimers = new Map();
  const backendInstanceId = crypto.randomUUID();
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ??
    (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "1" || process.env.RENDER === "true"
      ? 1
      : false));
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "same-origin");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "16kb", type: "application/json" }));
  app.use(session({
    name: SESSION_NAME,
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_MAX_AGE
    }
  }));

  function requireSameOriginJson(req, res, next) {
    const origin = req.get("origin");
    if (!req.is("application/json") || !origin ||
        origin !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: "Same-origin JSON requests are required." });
    }
    next();
  }
  function requireAdmin(req, res, next) {
    if (req.session.role !== "admin") return res.status(401).json({ error: "Admin authentication required." });
    next();
  }
  function requireParticipant(req, res, next) {
    if (req.session.role !== "participant") return res.status(401).json({ error: "Quiz session is unavailable." });
    next();
  }
  function requirePracticeSession(req, res, next) {
    if (req.session.role === "participant") {
      return res.status(403).json({ error: "Practice evaluation is unavailable during the symposium quiz." });
    }
    next();
  }
  function saveSession(req, res, callback) {
    req.session.save(error => {
      if (error) return res.status(500).json({ error: "Could not persist the secure session." });
      callback();
    });
  }
  function monitorStatus(row, now = Date.now()) {
    if (row.current_state === "COMPLETED") return "COMPLETED";
    if (now - new Date(row.last_activity).getTime() > STALE_AFTER_MS) return "STALE";
    if (row.current_state === "AWAY") return "AWAY";
    if (row.tab_switches || row.focus_losses || row.fullscreen_exits) return "ATTENTION";
    return "ACTIVE";
  }
  function adminAttempts() {
    const rapidBySession = new Map(statements.allRapidFinalAttempts.all().map(record => {
      const current = advanceExpiredRapidFinal(record, rapidFinalClock());
      return [current.quiz_session_id, current];
    }));
    const records = statements.allAttempts.all().map(row => {
      const record = JSON.parse(row.attempt_json);
      const rapid = rapidFinalAdminView(rapidBySession.get(row.quiz_session_id));
      const mainPercentage = record.status === "Completed"
        ? record.score / record.totalQuestions * 100
        : null;
      return {
        ...record,
        rapidFinal: {
          eligible: rapidFinalEligible(record),
          mainPercentage,
          status: rapid.status,
          score: rapid.score,
          startedAt: rapid.startedAt || null,
          completedAt: rapid.completedAt || null,
          totalCorrectResponseMs: rapid.totalCorrectResponseMs || 0,
          unansweredCount: rapid.unansweredCount || 0,
          answers: rapid.answers || [],
          ranking: null,
          combinedScore: rapid.status === "completed" ? record.score + rapid.score : null
        }
      };
    });
    return rankRapidFinal(records);
  }
  function snapshot() {
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const now = Date.now();
    return {
      serverTime: serverTimestamp(),
      backendInstanceId,
      participants: statements.activeSessions.all(cutoff).map(row => snapshotParticipant(row, now)),
      events: statements.recentEvents.all(cutoff),
      attempts: adminAttempts()
    };
  }
  function publishParticipant(row, event = null) {
    if (!row || adminStreams.size === 0) return;
    const isVisible = row.current_state !== "COMPLETED" &&
      Date.now() - new Date(row.created_at).getTime() <= ACTIVE_WINDOW_MS;
    const message = isVisible
      ? { type: "upsert", participant: snapshotParticipant(row), event }
      : { type: "remove", quizSessionId: row.quiz_session_id, event };
    const payload = `event: monitor\ndata: ${JSON.stringify(message)}\n\n`;
    for (const response of adminStreams.keys()) {
      if (!response.write(payload)) {
        response.end();
        adminStreams.delete(response);
      }
    }
  }
  function publishAttempt(attempt) {
    if (adminStreams.size === 0) return;
    const adminAttempt = adminAttempts().find(record => record.id === attempt.id) || attempt;
    const payload = `event: monitor\ndata: ${JSON.stringify({ type: "attempt-upsert", attempt: adminAttempt })}\n\n`;
    for (const response of adminStreams.keys()) {
      if (!response.write(payload)) {
        response.end();
        adminStreams.delete(response);
      }
    }
  }
  function publishRapidFinalUpdate(quizSessionId) {
    const saved = statements.getAttempt.get(quizSessionId);
    if (saved) publishAttempt(JSON.parse(saved.attempt_json));
  }
  function snapshotParticipant(row, now = Date.now()) {
    return {
      quizSessionId: row.quiz_session_id,
      participantId: row.participant_id,
      participantName: row.participant_name,
      college: row.college,
      email: row.email,
      phone: row.phone,
      department: row.department,
      year: row.year,
      deviceType: row.device_type,
      loginTime: row.created_at,
      round: row.current_round,
      questionNumber: row.current_question,
      quizStatus: "In Progress",
      tabSwitches: row.tab_switches,
      focusLosses: row.focus_losses,
      fullscreenExits: row.fullscreen_exits,
      returns: row.returns,
      lastActivity: row.last_activity,
      lastEvent: row.last_event,
      currentStatus: monitorStatus(row, now)
    };
  }
  function monitorEvent(row, eventType, timestamp, round, questionNumber, durationSeconds, eventId) {
    return {
      event_id: eventId,
      participant_id: row.participant_id,
      participant_name: row.participant_name,
      quiz_session_id: row.quiz_session_id,
      round,
      question_number: questionNumber,
      event_type: eventType,
      timestamp,
      duration_seconds: durationSeconds
    };
  }
  function scheduleStaleRefresh(row) {
    const existing = staleTimers.get(row.quiz_session_id);
    if (existing) clearTimeout(existing);
    staleTimers.delete(row.quiz_session_id);
    if (row.current_state === "COMPLETED") return;
    const staleAt = new Date(row.last_activity).getTime() + STALE_AFTER_MS + 1;
    const timer = setTimeout(() => {
      staleTimers.delete(row.quiz_session_id);
      const latest = statements.getSession.get(row.quiz_session_id);
      if (!latest || latest.current_state === "COMPLETED") return;
      if (monitorStatus(latest) === "STALE") publishParticipant(latest);
      else scheduleStaleRefresh(latest);
    }, Math.max(0, staleAt - Date.now()));
    timer.unref();
    staleTimers.set(row.quiz_session_id, timer);
  }
  statements.activeSessions.all(new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString())
    .forEach(scheduleStaleRefresh);
  function closeAdminStreams(sessionId) {
    for (const [response, streamSessionId] of adminStreams) {
      if (streamSessionId === sessionId) response.end();
    }
  }
  function appendEvent(row, type, context, timestamp, durationSeconds = null, clientEventId = null) {
    return statements.insertEvent.run(
      row.participant_id, row.participant_name, row.quiz_session_id,
      context.round, context.questionNumber, type, timestamp, durationSeconds, clientEventId
    ).lastInsertRowid;
  }

  app.get("/api/admin/session", (req, res) => {
    res.json({ authenticated: req.session.role === "admin" });
  });
  app.post("/api/practice/evaluate", requireSameOriginJson, requirePracticeSession, (req, res) => {
    const { questionId, choice } = req.body;
    const key = typeof questionId === "string" ? QUIZ_ANSWER_KEY[questionId] : null;
    if (!key || (choice !== null && !["legitimate", "phishing"].includes(choice))) {
      return res.status(400).json({ error: "Practice answer is invalid." });
    }
    res.json({
      correct: choice === key.answer,
      correctAnswer: key.answer,
      explanation: key.explanation,
      flags: key.flags,
      tip: key.tip
    });
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", backendInstanceId });
  });
  app.post("/api/admin/login", requireSameOriginJson, (req, res) => {
    if (!isText(req.body.adminId, 120) || typeof req.body.password !== "string" ||
        !safeEqual(req.body.adminId.trim(), adminId) ||
        !verifyAdminPassword(req.body.password, adminPasswordHash)) {
      return res.status(401).json({ error: "Admin ID or password is incorrect." });
    }
    req.session.regenerate(error => {
      if (error) return res.status(500).json({ error: "Could not establish admin session." });
      req.session.role = "admin";
      saveSession(req, res, () => res.json({ authenticated: true }));
    });
  });
  app.post("/api/admin/logout", requireSameOriginJson, (req, res) => {
    const sessionId = req.sessionID;
    req.session.destroy(error => {
      if (error) return res.status(500).json({ error: "Could not end admin session." });
      closeAdminStreams(sessionId);
      res.clearCookie(SESSION_NAME, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
      res.json({ authenticated: false });
    });
  });
  app.get("/api/admin/monitor/snapshot", requireAdmin, (req, res) => res.json(snapshot()));
  app.get("/api/admin/monitor/stream", requireAdmin, (req, res) => {
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();
    adminStreams.set(res, req.sessionID);
    res.write(`retry: 2000\n\nevent: monitor\ndata: ${JSON.stringify({ type: "snapshot", ...snapshot() })}\n\n`);
    const keepAlive = setInterval(() => {
      if (!res.write(": keep-alive\n\n")) res.end();
    }, 20000);
    res.on("close", () => {
      clearInterval(keepAlive);
      adminStreams.delete(res);
    });
  });

  app.post("/api/monitor/sessions", requireSameOriginJson, (req, res, next) => {
    if (req.session.role === "admin") return res.status(403).json({ error: "Admin sessions cannot start participant monitoring." });
    if (!["fullName", "college", "email", "department", "year"].every(key => isText(req.body.participant?.[key], key === "email" ? 254 : 160)) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.participant.email) ||
        (req.body.participant.phone != null && req.body.participant.phone !== "" &&
          !isText(req.body.participant.phone, 40)) ||
        !Number.isInteger(req.body.round) || req.body.round < 1 || req.body.round > 3) {
      return res.status(400).json({ error: "Participant quiz session details are invalid." });
    }
    const question = parseRoundQuestion(req.body);
    if (!question) return res.status(400).json({ error: "Round or question number is invalid." });
    if (req.session.role && req.session.role !== "participant") {
      return res.status(403).json({ error: "This browser session cannot monitor a participant quiz." });
    }
    req.session.role = "participant";
    const timestamp = serverTimestamp();
    const startRequestId = req.body.startRequestId || req.body.quizSessionId;
    if (!isText(startRequestId, 80) ||
        !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(startRequestId)) {
      return res.status(400).json({ error: "Participant session request ID is invalid." });
    }
    const existingSession = statements.findStartRequest.get(startRequestId);
    if (existingSession) {
      const participant = req.body.participant;
      const sameParticipant = existingSession.participant_name === participant.fullName.trim() &&
        existingSession.college === participant.college.trim() &&
        existingSession.email === participant.email.trim() &&
        existingSession.department === participant.department.trim() &&
        existingSession.year === participant.year.trim();
      if (!sameParticipant || existingSession.current_state === "COMPLETED") {
        return res.status(409).json({ error: "Participant quiz session cannot be started again." });
      }
      statements.updateOwner.run(req.sessionID, existingSession.quiz_session_id);
      return saveSession(req, res, () => {
        const resumedSession = statements.getSession.get(existingSession.quiz_session_id);
        scheduleStaleRefresh(resumedSession);
        publishParticipant(resumedSession);
        res.json({
          quizSessionId: existingSession.quiz_session_id,
          participantId: existingSession.participant_id,
          timestamp: existingSession.created_at,
          resumed: true
        });
      });
    }
    const quizSessionId = crypto.randomUUID();
    const participantId = `PG-${new Date().getFullYear()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    try {
      const transaction = db.transaction(() => {
        statements.insertSession.run({
          quizSessionId,
          participantId,
          clientStartId: startRequestId,
          participantName: req.body.participant.fullName.trim(),
          college: req.body.participant.college.trim(),
          email: req.body.participant.email.trim(),
          phone: req.body.participant.phone ? req.body.participant.phone.trim() : "",
          department: req.body.participant.department.trim(),
          year: req.body.participant.year.trim(),
          deviceType: deviceType(req.get("user-agent")),
          ownerSid: req.sessionID,
          round: question.round,
          questionNumber: question.questionNumber,
          timestamp,
          eventType: "SESSION_STARTED"
        });
        const row = statements.getSession.get(quizSessionId);
        const eventId = appendEvent(row, "SESSION_STARTED", question, timestamp);
        return { row, eventId };
      });
      const { row, eventId } = transaction();
      saveSession(req, res, () => {
        scheduleStaleRefresh(row);
        publishParticipant(row, monitorEvent(row, "SESSION_STARTED", timestamp,
          question.round, question.questionNumber, null, eventId));
        res.status(201).json({ quizSessionId, participantId, timestamp });
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/monitor/sessions/:id/resume", requireSameOriginJson, requireParticipant, (req, res) => {
    const row = statements.findOwnedSession.get(req.params.id, req.sessionID);
    if (!row || row.current_state === "COMPLETED") {
      return res.status(404).json({ error: "Active quiz monitoring session was not found." });
    }
    const question = parseRoundQuestion(req.body);
    if (!question) return res.status(400).json({ error: "Round or question number is invalid." });
    const timestamp = serverTimestamp();
    const resumed = row.current_state === "AWAY";
    const durationSeconds = resumed && row.inactive_since
      ? Math.max(0, Math.floor((Date.now() - new Date(row.inactive_since).getTime()) / 1000))
      : null;
    const nextState = {
      ...row,
      current_round: question.round,
      current_question: question.questionNumber,
      current_state: "ACTIVE",
      inactive_since: null,
      returns: row.returns + (resumed ? 1 : 0)
    };
    const eventType = resumed ? "RETURNED" : "PAGE_RESUMED";
    const insertEvent = db.transaction(() => {
      statements.updateSession.run({
        quizSessionId: row.quiz_session_id, round: question.round, questionNumber: question.questionNumber,
        state: "ACTIVE", timestamp, eventType, inactiveSince: null,
        tabSwitches: row.tab_switches, focusLosses: row.focus_losses,
        fullscreenExits: row.fullscreen_exits, returns: nextState.returns
      });
      return appendEvent(nextState, eventType, question, timestamp, durationSeconds);
    });
    const eventId = insertEvent();
    const resumedRow = statements.getSession.get(row.quiz_session_id);
    scheduleStaleRefresh(resumedRow);
    publishParticipant(resumedRow,
      monitorEvent(resumedRow, eventType, timestamp, question.round, question.questionNumber, durationSeconds, eventId));
    res.json({ quizSessionId: row.quiz_session_id, participantId: row.participant_id, timestamp });
  });
  app.post("/api/monitor/events", requireSameOriginJson, requireParticipant, (req, res, next) => {
    const { quizSessionId, eventType, clientEventId } = req.body;
    if (!isText(quizSessionId, 80) || !ALLOWED_EVENTS.has(eventType)) {
      return res.status(400).json({ error: "Monitoring event is invalid." });
    }
    if (clientEventId != null &&
        (typeof clientEventId !== "string" ||
         !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(clientEventId))) {
      return res.status(400).json({ error: "Monitoring event ID is invalid." });
    }
    const question = parseRoundQuestion(req.body);
    if (!question) return res.status(400).json({ error: "Round or question number is invalid." });
    const row = statements.findOwnedSession.get(quizSessionId, req.sessionID);
    if (!row || row.current_state === "COMPLETED") {
      return res.status(404).json({ error: "Active quiz monitoring session was not found." });
    }
    if (clientEventId) {
      const existingEvent = statements.findClientEvent.get(clientEventId);
      if (existingEvent) {
        return res.status(200).json({ timestamp: existingEvent.timestamp, recorded: false });
      }
    }
    if (question.round < row.current_round ||
        (question.round === row.current_round && question.questionNumber < row.current_question)) {
      return res.status(409).json({ error: "Quiz progress cannot move backwards." });
    }
    if ((eventType === "TAB_HIDDEN" || eventType === "WINDOW_BLUR") &&
        row.current_state === "AWAY" && row.last_event === eventType) {
      return res.status(200).json({ timestamp: row.last_activity, recorded: false });
    }
    if (eventType === "RETURNED" && row.current_state !== "AWAY") {
      return res.status(200).json({ timestamp: row.last_activity, recorded: false });
    }
    const timestamp = serverTimestamp();
    const inactiveSince = row.inactive_since;
    let state = row.current_state;
    let tabs = row.tab_switches;
    let focusLosses = row.focus_losses;
    let fullscreenExits = row.fullscreen_exits;
    let returns = row.returns;
    let durationSeconds = null;
    if (eventType === "TAB_HIDDEN") {
      tabs++;
      state = "AWAY";
    } else if (eventType === "WINDOW_BLUR") {
      focusLosses++;
      state = "AWAY";
    } else if (eventType === "RETURNED") {
      if (state === "AWAY") {
        durationSeconds = inactiveSince
          ? Math.max(0, Math.floor((Date.now() - new Date(inactiveSince).getTime()) / 1000))
          : 0;
        returns++;
      }
      state = "ACTIVE";
    } else if (eventType === "FULLSCREEN_EXIT") {
      fullscreenExits++;
    } else if (eventType === "PAGE_HIDDEN") {
      state = "AWAY";
    } else if (eventType === "QUIZ_COMPLETED") {
      if (question.round !== 3 || question.questionNumber !== ROUND_SIZES[2]) {
        return res.status(400).json({ error: "Only the final quiz question can complete a monitoring session." });
      }
      state = "COMPLETED";
    }
    const nextInactiveSince = state === "AWAY" ? (inactiveSince || timestamp) : null;
    const updated = {
      ...row,
      current_round: question.round,
      current_question: question.questionNumber,
      current_state: state,
      inactive_since: nextInactiveSince,
      tab_switches: tabs,
      focus_losses: focusLosses,
      fullscreen_exits: fullscreenExits,
      returns
    };
    try {
      const insertEvent = db.transaction(() => {
        statements.updateSession.run({
          quizSessionId, round: question.round, questionNumber: question.questionNumber,
          state, timestamp, eventType, inactiveSince: nextInactiveSince,
          tabSwitches: tabs, focusLosses, fullscreenExits, returns
        });
        if (eventType !== "QUIZ_PROGRESS") {
          return appendEvent(updated, eventType, question, timestamp, durationSeconds, clientEventId);
        }
        return null;
      });
      const progressEvent = eventId => eventId == null ? null :
        monitorEvent(statements.getSession.get(quizSessionId), eventType, timestamp,
          question.round, question.questionNumber, durationSeconds, eventId);
      const insertedEventId = insertEvent();
      const savedRow = statements.getSession.get(quizSessionId);
      scheduleStaleRefresh(savedRow);
      const progressChanged = eventType !== "QUIZ_PROGRESS" ||
        question.round !== row.current_round ||
        question.questionNumber !== row.current_question ||
        row.current_state !== state ||
        monitorStatus(row) === "STALE";
      if (progressChanged) publishParticipant(savedRow, progressEvent(insertedEventId));
      res.status(201).json({ timestamp, recorded: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/monitor/attempts", requireSameOriginJson, requireParticipant, (req, res, next) => {
    const { quizSessionId, attempt } = req.body;
    if (!isText(quizSessionId, 80)) {
      return res.status(400).json({ error: "Participant quiz session is invalid." });
    }
    const row = statements.findOwnedSession.get(quizSessionId, req.sessionID);
    if (!row) return res.status(404).json({ error: "Participant quiz session was not found." });
    const record = normalizeAttempt(attempt, row);
    if (!record) return res.status(400).json({ error: "Participant quiz attempt is invalid." });
    const previous = statements.getAttempt.get(quizSessionId);
    if (previous && JSON.parse(previous.attempt_json).status === "Completed" &&
        JSON.stringify(JSON.parse(previous.attempt_json)) !== JSON.stringify(record)) {
      return res.status(409).json({ error: "A completed main quiz attempt cannot be changed." });
    }
    const updatedAt = serverTimestamp();
    try {
      statements.saveAttempt.run(quizSessionId, row.participant_id, JSON.stringify(record), updatedAt);
      publishAttempt(record);
      const result = { participantId: row.participant_id, updatedAt };
      if (record.status === "Completed") {
        result.score = record.score;
        result.roundScores = record.roundScores;
        result.accuracy = record.accuracy;
        result.rapidFinalEligible = rapidFinalEligible(record);
        result.mainPercentage = record.score / record.totalQuestions * 100;
        result.review = participantMainReview(record);
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  function completedParticipantAttempt(req) {
    const row = statements.latestOwnedAttempt.get(req.sessionID);
    if (!row) return null;
    return {
      quizSessionId: row.quiz_session_id,
      attempt: JSON.parse(row.attempt_json)
    };
  }

  function updateRapidFinalRecord(record, expectedRecord) {
    const result = statements.updateRapidFinalAttempt.run({
      quizSessionId: record.quiz_session_id,
      status: record.status,
      questionIndex: record.question_index,
      questionStartedAt: record.question_started_at,
      expectedQuestionIndex: expectedRecord.question_index,
      expectedQuestionStartedAt: expectedRecord.question_started_at,
      answersJson: record.answers_json,
      completedAt: record.completed_at,
      score: record.score,
      totalCorrectResponseMs: record.total_correct_response_ms,
      updatedAt: record.updated_at
    });
    return result.changes === 1;
  }

  function advanceExpiredRapidFinal(record, now) {
    if (!record || record.status !== "in_progress") return record;
    const answers = JSON.parse(record.answers_json);
    let questionIndex = record.question_index;
    let questionStartedAt = record.question_started_at;
    let completedAt = record.completed_at;
    let score = record.score;
    let totalCorrectResponseMs = record.total_correct_response_ms;
    let changed = false;
    while (questionIndex < RAPID_FINAL_QUESTION_COUNT &&
        now >= questionStartedAt + RAPID_FINAL_QUESTION_MS) {
      const deadline = questionStartedAt + RAPID_FINAL_QUESTION_MS;
      answers.push({
        questionId: RAPID_FINAL_QUESTIONS[questionIndex].id,
        choiceIndex: null,
        isCorrect: false,
        startedAt: questionStartedAt,
        submittedAt: deadline,
        responseTimeMs: RAPID_FINAL_QUESTION_MS,
        requestId: null
      });
      questionIndex++;
      questionStartedAt = deadline;
      changed = true;
      if (questionIndex === RAPID_FINAL_QUESTION_COUNT) {
        completedAt = deadline;
        score = answers.filter(answer => answer.isCorrect).length;
      }
    }
    if (!changed) return record;
    const updated = {
      ...record,
      status: questionIndex === RAPID_FINAL_QUESTION_COUNT ? "completed" : "in_progress",
      question_index: questionIndex,
      question_started_at: questionStartedAt,
      answers_json: JSON.stringify(answers),
      completed_at: completedAt,
      score,
      total_correct_response_ms: totalCorrectResponseMs,
      updated_at: now
    };
    if (!updateRapidFinalRecord(updated, record)) {
      return statements.rapidForSession.get(record.quiz_session_id);
    }
    return updated;
  }

  app.get("/api/rapid-final/status", requireParticipant, (req, res) => {
    const owned = completedParticipantAttempt(req);
    if (!owned) return res.status(403).json({ error: "Complete the main quiz before checking RAPID FINAL eligibility." });
    const eligible = rapidFinalEligible(owned.attempt);
    const rapid = eligible ? statements.rapidForSession.get(owned.quizSessionId) : null;
    const now = rapidFinalClock();
    const current = rapid ? advanceExpiredRapidFinal(rapid, now) : null;
    if (rapid && current.updated_at !== rapid.updated_at) publishRapidFinalUpdate(owned.quizSessionId);
    res.json({
      eligible,
      mainPercentage: owned.attempt.score / owned.attempt.totalQuestions * 100,
      mainScore: owned.attempt.score,
      mainRoundScores: owned.attempt.roundScores,
      mainReview: participantMainReview(owned.attempt),
      participantId: owned.attempt.id,
      status: !eligible ? "not_eligible" : current ? current.status : "available",
      rapidFinal: rapidFinalPublicState(current, now)
    });
  });

  app.post("/api/rapid-final/start", requireSameOriginJson, requireParticipant, (req, res) => {
    const owned = completedParticipantAttempt(req);
    if (!owned || !rapidFinalEligible(owned.attempt)) {
      return res.status(403).json({ error: "RAPID FINAL requires a completed main-quiz score of at least 95%." });
    }
    let record = statements.rapidForSession.get(owned.quizSessionId);
    const now = rapidFinalClock();
    if (!record) {
      statements.insertRapidFinalAttempt.run(
        owned.quizSessionId, owned.attempt.id, now, now, now
      );
      record = statements.rapidForSession.get(owned.quizSessionId);
    }
    record = advanceExpiredRapidFinal(record, now);
    publishRapidFinalUpdate(owned.quizSessionId);
    res.json(rapidFinalPublicState(record, now));
  });

  app.get("/api/rapid-final/state", requireParticipant, (req, res) => {
    const owned = completedParticipantAttempt(req);
    if (!owned || !rapidFinalEligible(owned.attempt)) {
      return res.status(403).json({ error: "RAPID FINAL is available only to participants who qualify." });
    }
    const record = statements.rapidForSession.get(owned.quizSessionId);
    if (!record) return res.status(404).json({ error: "RAPID FINAL has not been started." });
    const now = rapidFinalClock();
    const current = advanceExpiredRapidFinal(record, now);
    if (current.updated_at !== record.updated_at) publishRapidFinalUpdate(owned.quizSessionId);
    res.json(rapidFinalPublicState(current, now));
  });

  app.post("/api/rapid-final/answer", requireSameOriginJson, requireParticipant, (req, res) => {
    const owned = completedParticipantAttempt(req);
    if (!owned || !rapidFinalEligible(owned.attempt)) {
      return res.status(403).json({ error: "RAPID FINAL is available only to participants who qualify." });
    }
    if (!Number.isInteger(req.body.questionIndex) ||
        (req.body.choiceIndex !== null &&
          (!Number.isInteger(req.body.choiceIndex) || req.body.choiceIndex < 0 || req.body.choiceIndex > 3)) ||
        !isText(req.body.requestId, 80) ||
        !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(req.body.requestId)) {
      return res.status(400).json({ error: "RAPID FINAL answer submission is invalid." });
    }
    let record = statements.rapidForSession.get(owned.quizSessionId);
    if (!record) return res.status(404).json({ error: "RAPID FINAL has not been started." });
    const answers = JSON.parse(record.answers_json);
    if (answers.some(answer => answer.requestId === req.body.requestId)) {
      const now = rapidFinalClock();
      return res.json(rapidFinalPublicState(advanceExpiredRapidFinal(record, now), now));
    }
    const now = rapidFinalClock();
    record = advanceExpiredRapidFinal(record, now);
    if (record.status === "completed") return res.json(rapidFinalPublicState(record, now));
    if (req.body.questionIndex !== record.question_index) {
      return res.status(409).json({
        error: "That question is no longer active.",
        state: rapidFinalPublicState(record, now)
      });
    }
    const responseTimeMs = Math.max(0, now - record.question_started_at);
    const question = RAPID_FINAL_QUESTIONS[record.question_index];
    answers.push({
      questionId: question.id,
      choiceIndex: req.body.choiceIndex,
      isCorrect: req.body.choiceIndex === question.answer,
      startedAt: record.question_started_at,
      submittedAt: now,
      responseTimeMs,
      requestId: req.body.requestId
    });
    const nextIndex = record.question_index + 1;
    const completed = nextIndex === RAPID_FINAL_QUESTION_COUNT;
    const score = completed ? answers.filter(answer => answer.isCorrect).length : null;
    const correctTime = req.body.choiceIndex === question.answer
      ? responseTimeMs : 0;
    const updated = {
      ...record,
      status: completed ? "completed" : "in_progress",
      question_index: nextIndex,
      question_started_at: now,
      answers_json: JSON.stringify(answers),
      completed_at: completed ? now : null,
      score,
      total_correct_response_ms: record.total_correct_response_ms + correctTime,
      updated_at: now
    };
    if (!updateRapidFinalRecord(updated, record)) {
      const latest = statements.rapidForSession.get(owned.quizSessionId);
      return res.status(409).json({
        error: "That answer was already recorded.",
        state: rapidFinalPublicState(latest, now)
      });
    }
    publishRapidFinalUpdate(owned.quizSessionId);
    res.json(rapidFinalPublicState(updated, now));
  });

  app.use((req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch (error) {
      return res.sendStatus(400);
    }
    if (["/server.js", "/package.json", "/package-lock.json", "/js/admin-config.js"].includes(pathname) ||
        /\.(?:sqlite|sqlite-shm|sqlite-wal)$/i.test(pathname) ||
        ["/data", "/node_modules", "/private", "/test"].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return res.sendStatus(404);
    }
    next();
  });
  app.use(express.static(ROOT, {
    dotfiles: "deny",
    index: "index.html",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    }
  }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error("PhishGuard server error:", error);
    res.status(500).json({ error: "The server could not complete the request." });
  });

  return {
    app,
    close() {
      for (const timer of staleTimers.values()) clearTimeout(timer);
      staleTimers.clear();
      for (const response of adminStreams.keys()) response.end();
      adminStreams.clear();
      sessionStore.emit("disconnect");
      db.close();
    }
  };
}

if (require.main === module) {
  try {
    const { app } = createApp();
    const port = Number(process.env.PORT || 8000);
    const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
    app.listen(port, host, () => console.log(`PhishGuard listening on http://${host}:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp, rapidFinalEligible, rankRapidFinal };
