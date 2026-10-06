"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { after, before, test } = require("node:test");
const { createApp } = require("../server");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "phishguard-monitor-"));
const testPassword = "a-long-test-password";
const testSalt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const testPasswordHash = `scrypt$${testSalt.toString("hex")}$${crypto.scryptSync(testPassword, testSalt, 64).toString("hex")}`;
const runtime = createApp({
  adminId: "test-organizer",
  adminPasswordHash: testPasswordHash,
  sessionSecret: "test-session-secret-that-is-long-enough",
  trustProxy: 1,
  dbPath: path.join(tempDirectory, "monitor.sqlite")
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

  const retriedStart = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    cookie: mobileCookie,
    body: participantStart
  });
  assert.equal(retriedStart.response.status, 200);
  assert.equal(retriedStart.result.quizSessionId, mobileStart.result.quizSessionId);
  assert.equal(retriedStart.result.participantId, mobileStart.result.participantId);
  const snapshot = await jsonRequest("/api/admin/monitor/snapshot", { cookie: adminCookie });
  assert.equal(snapshot.result.participants.length, 2);

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
  assert.equal((await closed).done, true);
  await reconnectedReader.cancel();
});

test("private monitoring database and server configuration are not static assets", async () => {
  for (const asset of ["/server.js", "/package.json", "/data/monitor.sqlite", "/js/admin-config.js"]) {
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
