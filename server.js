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
      participant_name TEXT NOT NULL,
      college TEXT NOT NULL,
      email TEXT NOT NULL,
      department TEXT NOT NULL,
      year TEXT NOT NULL,
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
      duration_seconds INTEGER
    );
    CREATE INDEX IF NOT EXISTS monitor_events_recent
      ON quiz_monitor_events(timestamp DESC);
  `);
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
        quiz_session_id, participant_id, participant_name, college, email, department, year,
        owner_sid, current_round, current_question, current_state, created_at, updated_at,
        last_activity, last_event
      ) VALUES (
        @quizSessionId, @participantId, @participantName, @college, @email, @department, @year,
        @ownerSid, @round, @questionNumber, 'ACTIVE', @timestamp, @timestamp, @timestamp, @eventType
      )
    `),
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
        event_type, timestamp, duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    activeSessions: db.prepare(`
      SELECT * FROM quiz_monitor_sessions
      WHERE current_state != 'COMPLETED' AND created_at >= ?
      ORDER BY last_activity DESC
    `),
    recentEvents: db.prepare(`
      SELECT participant_id, participant_name, quiz_session_id, round, question_number,
        event_type, timestamp, duration_seconds
      FROM quiz_monitor_events WHERE timestamp >= ? AND event_type != 'QUIZ_PROGRESS'
      ORDER BY event_id DESC LIMIT 50
    `)
  };
  const adminStreams = new Map();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "1");
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
    if (row.current_state === "AWAY") return "AWAY";
    if (now - new Date(row.last_activity).getTime() > STALE_AFTER_MS) return "STALE";
    if (row.tab_switches || row.focus_losses || row.fullscreen_exits) return "ATTENTION";
    return "ACTIVE";
  }
  function snapshot() {
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const now = Date.now();
    return {
      serverTime: serverTimestamp(),
      participants: statements.activeSessions.all(cutoff).map(row => ({
        quizSessionId: row.quiz_session_id,
        participantId: row.participant_id,
        participantName: row.participant_name,
        college: row.college,
        email: row.email,
        department: row.department,
        year: row.year,
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
      })),
      events: statements.recentEvents.all(cutoff)
    };
  }
  function publish() {
    const payload = `event: monitor\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const response of adminStreams.keys()) response.write(payload);
  }
  function closeAdminStreams(sessionId) {
    for (const [response, streamSessionId] of adminStreams) {
      if (streamSessionId === sessionId) response.end();
    }
  }
  function appendEvent(row, type, context, timestamp, durationSeconds = null) {
    statements.insertEvent.run(
      row.participant_id, row.participant_name, row.quiz_session_id,
      context.round, context.questionNumber, type, timestamp, durationSeconds
    );
  }

  app.get("/api/admin/session", (req, res) => {
    res.json({ authenticated: req.session.role === "admin" });
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
    res.write(`event: monitor\ndata: ${JSON.stringify(snapshot())}\n\n`);
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20000);
    req.on("close", () => {
      clearInterval(keepAlive);
      adminStreams.delete(res);
    });
  });

  app.post("/api/monitor/sessions", requireSameOriginJson, (req, res, next) => {
    if (req.session.role === "admin") return res.status(403).json({ error: "Admin sessions cannot start participant monitoring." });
    if (!["fullName", "college", "email", "department", "year"].every(key => isText(req.body.participant?.[key], key === "email" ? 254 : 160)) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.participant.email) ||
        !/^PG-\d{4}-\d{4,}$/.test(req.body.participantId || "") ||
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
    const quizSessionId = crypto.randomUUID();
    try {
      const transaction = db.transaction(() => {
        statements.insertSession.run({
          quizSessionId,
          participantId: req.body.participantId,
          participantName: req.body.participant.fullName.trim(),
          college: req.body.participant.college.trim(),
          email: req.body.participant.email.trim(),
          department: req.body.participant.department.trim(),
          year: req.body.participant.year.trim(),
          ownerSid: req.sessionID,
          round: question.round,
          questionNumber: question.questionNumber,
          timestamp,
          eventType: "SESSION_STARTED"
        });
        appendEvent(statements.getSession.get(quizSessionId), "SESSION_STARTED", question, timestamp);
      });
      transaction();
      saveSession(req, res, () => {
        publish();
        res.status(201).json({ quizSessionId, timestamp });
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
    const transaction = db.transaction(() => {
      statements.updateSession.run({
        quizSessionId: row.quiz_session_id, round: question.round, questionNumber: question.questionNumber,
        state: "ACTIVE", timestamp, eventType, inactiveSince: null,
        tabSwitches: row.tab_switches, focusLosses: row.focus_losses,
        fullscreenExits: row.fullscreen_exits, returns: nextState.returns
      });
      appendEvent(nextState, eventType, question, timestamp, durationSeconds);
    });
    transaction();
    publish();
    res.json({ quizSessionId: row.quiz_session_id, timestamp });
  });
  app.post("/api/monitor/events", requireSameOriginJson, requireParticipant, (req, res, next) => {
    const { quizSessionId, eventType } = req.body;
    if (!isText(quizSessionId, 80) || !ALLOWED_EVENTS.has(eventType)) {
      return res.status(400).json({ error: "Monitoring event is invalid." });
    }
    const question = parseRoundQuestion(req.body);
    if (!question) return res.status(400).json({ error: "Round or question number is invalid." });
    const row = statements.findOwnedSession.get(quizSessionId, req.sessionID);
    if (!row || row.current_state === "COMPLETED") {
      return res.status(404).json({ error: "Active quiz monitoring session was not found." });
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
      const transaction = db.transaction(() => {
        statements.updateSession.run({
          quizSessionId, round: question.round, questionNumber: question.questionNumber,
          state, timestamp, eventType, inactiveSince: nextInactiveSince,
          tabSwitches: tabs, focusLosses, fullscreenExits, returns
        });
        appendEvent(updated, eventType, question, timestamp, durationSeconds);
      });
      transaction();
      publish();
      res.status(201).json({ timestamp, recorded: true });
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

  const heartbeat = setInterval(publish, 15000);
  heartbeat.unref();
  return {
    app,
    close() {
      clearInterval(heartbeat);
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
    const host = process.env.HOST || "127.0.0.1";
    app.listen(port, host, () => console.log(`PhishGuard listening on http://${host}:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp };
