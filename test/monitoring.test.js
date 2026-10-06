"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

async function jsonRequest(url, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json", Origin: baseUrl } : {}),
      ...(cookie ? { Cookie: cookie } : {})
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
  const start = await jsonRequest("/api/monitor/sessions", {
    method: "POST",
    body: {
      participantId: "PG-2026-0001",
      participant: {
        fullName: "Test Participant",
        college: "Example College",
        email: "participant@example.test",
        department: "Security",
        year: "I Year"
      },
      round: 1,
      questionNumber: 1
    }
  });
  assert.equal(start.response.status, 201);
  participantCookie = cookieFrom(start.response);
  quizSessionId = start.result.quizSessionId;

  const params = { quizSessionId, round: 1, questionNumber: 4 };
  for (const eventType of ["TAB_HIDDEN", "WINDOW_BLUR", "RETURNED", "FULLSCREEN_EXIT"]) {
    const event = await jsonRequest("/api/monitor/events", {
      method: "POST",
      cookie: participantCookie,
      body: { ...params, eventType }
    });
    assert.equal(event.response.status, 201);
    assert.ok(event.result.timestamp);
  }

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
  assert.equal(adminRead.result.events[0].event_type, "FULLSCREEN_EXIT");

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

test("admin event stream is authenticated and publishes current monitoring data", async () => {
  const response = await fetch(`${baseUrl}/api/admin/monitor/stream`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  assert.match(text, /event: monitor/);
  assert.match(text, /Test Participant/);
  const closed = reader.read();
  await jsonRequest("/api/admin/logout", {
    method: "POST",
    body: {},
    cookie: adminCookie
  });
  assert.equal((await closed).done, true);
  await reader.cancel();
});

test("private monitoring database and server configuration are not static assets", async () => {
  for (const asset of ["/server.js", "/package.json", "/data/monitor.sqlite", "/js/admin-config.js"]) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 404, `${asset} should not be publicly served`);
  }
});
