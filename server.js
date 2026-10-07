"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const Database = require("better-sqlite3");
const express = require("express");
const session = require("express-session");

const ROOT = __dirname;
const SESSION_NAME = "phishguard.sid";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 45 * 1000;
const ACTIVE_WINDOW_MS = 8 * 60 * 60 * 1000;
const ROUND_SIZES = Object.freeze([10, 10, 5]);
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
      !Array.isArray(attempt.questionIds) || attempt.questionIds.length !== 25 ||
      !attempt.questionIds.every(id => isText(id, 80)) ||
      new Set(attempt.questionIds).size !== 25 ||
      !Array.isArray(attempt.answers) || attempt.answers.length > 25 ||
      !Number.isInteger(attempt.currentRound) || attempt.currentRound < 1 || attempt.currentRound > 3 ||
      !Number.isInteger(attempt.currentQuestion) || attempt.currentQuestion < 0 ||
      attempt.currentQuestion > ROUND_SIZES[attempt.currentRound - 1] ||
      attempt.totalQuestions !== 25 ||
      !["In Progress", "Completed"].includes(attempt.status) ||
      !attempt.roundScores || typeof attempt.roundScores !== "object" ||
      ![1, 2, 3].every(round => Number.isInteger(attempt.roundScores[round]) &&
        attempt.roundScores[round] >= 0 && attempt.roundScores[round] <= ROUND_SIZES[round - 1])) {
    return null;
  }
  const answerIds = new Set();
  for (const answer of attempt.answers) {
    if (!answer || !attempt.questionIds.includes(answer.questionId) ||
        answerIds.has(answer.questionId) ||
        ![1, 2, 3].includes(answer.round) ||
        !["legitimate", "phishing"].includes(answer.choice)) return null;
    answerIds.add(answer.questionId);
  }
  if (attempt.status === "Completed" &&
      (attempt.currentRound !== 3 || attempt.currentQuestion !== ROUND_SIZES[2] ||
       attempt.answers.length !== 25 || !Number.isInteger(attempt.score) ||
       attempt.score < 0 || attempt.score > 25 ||
       !Number.isInteger(attempt.accuracy) || attempt.accuracy < 0 ||
       attempt.accuracy > 100 || !isText(attempt.completedAt, 40) ||
       Number.isNaN(Date.parse(attempt.completedAt)))) return null;

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
    totalQuestions: 25,
    roundScores: attempt.roundScores,
    score: attempt.status === "Completed" ? attempt.score : null,
    accuracy: attempt.status === "Completed" ? attempt.accuracy : null
  };
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
    allAttempts: db.prepare(`
      SELECT attempt_json FROM participant_attempts ORDER BY updated_at DESC
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
  function snapshot() {
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const now = Date.now();
    return {
      serverTime: serverTimestamp(),
      backendInstanceId,
      participants: statements.activeSessions.all(cutoff).map(row => snapshotParticipant(row, now)),
      events: statements.recentEvents.all(cutoff),
      attempts: statements.allAttempts.all().map(row => JSON.parse(row.attempt_json))
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
    const payload = `event: monitor\ndata: ${JSON.stringify({ type: "attempt-upsert", attempt })}\n\n`;
    for (const response of adminStreams.keys()) {
      if (!response.write(payload)) {
        response.end();
        adminStreams.delete(response);
      }
    }
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
    const updatedAt = serverTimestamp();
    try {
      statements.saveAttempt.run(quizSessionId, row.participant_id, JSON.stringify(record), updatedAt);
      publishAttempt(record);
      res.status(200).json({ participantId: row.participant_id, updatedAt });
    } catch (error) {
      next(error);
    }
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
        ["/data", "/node_modules", "/test"].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
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

module.exports = { createApp };
