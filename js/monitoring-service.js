/* Same-origin monitoring API; event timestamps and records are server-owned. */
(function () {
  const SESSION_KEY = "phishguard.monitor.session.v1";
  const START_REQUEST_KEY = "phishguard.monitor.start-request.v1";
  const API = "/api/monitor";
  const REQUEST_TIMEOUT_MS = 10000;
  const MAX_RETRY_MS = 30000;
  let active = false;
  let finishing = false;
  let sessionId = "";
  let pendingAttempt = null;
  let round = 1;
  let questionNumber = 1;
  let hidden = document.visibilityState !== "visible";
  let focused = document.hasFocus();
  let inactive = hidden || !focused;
  let fullscreenActive = Boolean(document.fullscreenElement);
  let heartbeat = 0;
  let startRetry = 0;
  let eventRetry = 0;
  let startRetryCount = 0;
  let eventRetryCount = 0;
  let startPromise = null;
  let eventFlushPromise = null;
  let attemptSyncPromise = null;
  let attemptSyncRetry = 0;
  let attemptSyncRetryCount = 0;
  let latestAttempt = null;
  let listenersAttached = false;
  let statusHandler = null;
  let identityHandler = null;
  const pendingEvents = [];

  function newId() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") {
      throw new Error("Secure browser randomness is unavailable; monitoring cannot be started.");
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function post(path, payload, keepalive = false) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          keepalive,
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        const networkError = new Error(error.message || "Monitoring service is unreachable.");
        networkError.retryable = true;
        throw networkError;
      }
      let result;
      try {
        result = await response.json();
      } catch (error) {
        const invalidResponse = new Error("Monitoring service returned an invalid response.");
        invalidResponse.status = response.status;
        throw invalidResponse;
      }
      if (!response.ok) {
        const requestError = new Error(result.error || "Monitoring service request failed.");
        requestError.status = response.status;
        throw requestError;
      }
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function isRetryable(error) {
    return error.retryable === true || error.status === 408 || error.status === 429 || error.status >= 500;
  }

  function reportError(error) {
    console.error("Quiz monitoring could not be synchronized:", error);
    if (statusHandler) statusHandler(error);
  }

  function context(eventType, clientEventId) {
    return { quizSessionId: sessionId, clientEventId, eventType, round, questionNumber };
  }

  function scheduleStartRetry(error) {
    if (!pendingAttempt || !isRetryable(error) || startRetry) return;
    const delay = Math.min(1000 * (2 ** startRetryCount), MAX_RETRY_MS);
    startRetryCount++;
    startRetry = window.setTimeout(() => {
      startRetry = 0;
      start(pendingAttempt);
    }, delay);
  }

  async function resumeIfPresent() {
    if (!sessionId) return false;
    return post(`${API}/sessions/${encodeURIComponent(sessionId)}/resume`, { round, questionNumber });
  }

  function applyServerIdentity(attempt, result) {
    if (!result.participantId) return;
    const changed = attempt.id !== result.participantId;
    attempt.id = result.participantId;
    attempt.startedAt = result.timestamp;
    if (changed && window.PGParticipantService) {
      window.PGParticipantService.reidentify(attempt, result.participantId, result.timestamp);
    }
    if (identityHandler) identityHandler(result.participantId);
  }

  function scheduleEventRetry(error) {
    if (!pendingEvents.length || !isRetryable(error) || eventRetry) return;
    const delay = Math.min(1000 * (2 ** eventRetryCount), MAX_RETRY_MS);
    eventRetryCount++;
    eventRetry = window.setTimeout(() => {
      eventRetry = 0;
      flushEvents();
    }, delay);
  }

  function scheduleAttemptRetry(error) {
    if (!latestAttempt || !isRetryable(error) || attemptSyncRetry) return;
    const delay = Math.min(1000 * (2 ** attemptSyncRetryCount), MAX_RETRY_MS);
    attemptSyncRetryCount++;
    attemptSyncRetry = window.setTimeout(() => {
      attemptSyncRetry = 0;
      syncAttempt(latestAttempt);
    }, delay);
  }

  function flushAttemptSync() {
    if (attemptSyncPromise) return attemptSyncPromise;
    if (!sessionId || !latestAttempt) return Promise.resolve(false);
    attemptSyncPromise = (async () => {
      while (sessionId && latestAttempt) {
        const attempt = latestAttempt;
        latestAttempt = null;
        try {
          await post(`${API}/attempts`, { quizSessionId: sessionId, attempt });
          attemptSyncRetryCount = 0;
          if (statusHandler) statusHandler(null);
        } catch (error) {
          latestAttempt = latestAttempt || attempt;
          reportError(error);
          if (isRetryable(error)) scheduleAttemptRetry(error);
          else latestAttempt = null;
          return false;
        }
      }
      return true;
    })().finally(() => {
      attemptSyncPromise = null;
      if (latestAttempt && !attemptSyncRetry) flushAttemptSync();
      finalizeSession();
    });
    return attemptSyncPromise;
  }

  function syncAttempt(attempt) {
    if (!attempt) return Promise.resolve(false);
    latestAttempt = attempt;
    return flushAttemptSync();
  }

  function flushEvents() {
    if (eventFlushPromise || !sessionId || pendingEvents.length === 0) return;
    eventFlushPromise = (async () => {
      while (sessionId && pendingEvents.length) {
        const item = pendingEvents[0];
        try {
          await post(`${API}/events`, item.payload, item.keepalive);
          pendingEvents.shift();
          if (statusHandler) statusHandler(null);
          if (item.resolve) item.resolve(true);
          eventRetryCount = 0;
        } catch (error) {
          if (isRetryable(error)) scheduleEventRetry(error);
          else {
            pendingEvents.shift();
            if (item.resolve) item.resolve(false);
            reportError(error);
          }
          return;
        }
      }
      finalizeSession();
    })().finally(() => {
      eventFlushPromise = null;
      if (sessionId && pendingEvents.length && !eventRetry) flushEvents();
    });
  }

  function sendEvent(eventType, keepalive = false) {
    if ((!active && !finishing) || !sessionId) return Promise.resolve(false);
    const clientEventId = newId();
    const item = { payload: context(eventType, clientEventId), keepalive };
    const delivered = new Promise(resolve => { item.resolve = resolve; });
    const last = pendingEvents[pendingEvents.length - 1];
    if (eventType === "QUIZ_PROGRESS" && last && last.payload.eventType === "QUIZ_PROGRESS") {
      if (last.resolve) last.resolve(false);
      pendingEvents[pendingEvents.length - 1] = item;
    } else {
      pendingEvents.push(item);
    }
    flushEvents();
    return delivered;
  }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
  }

  function activate() {
    if (active) return;
    active = true;
    hidden = document.visibilityState !== "visible";
    focused = document.hasFocus();
    inactive = hidden || !focused;
    fullscreenActive = Boolean(document.fullscreenElement);
    attachListeners();
    sendEvent("QUIZ_PROGRESS");
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = window.setInterval(() => {
      if (!hidden && focused) sendEvent("QUIZ_PROGRESS");
    }, 20000);
    if (inactive) {
      if (hidden) sendEvent("TAB_HIDDEN", true);
      if (!focused) sendEvent("WINDOW_BLUR", true);
    }
  }

  async function establishSession(attempt) {
    round = attempt.currentRound;
    questionNumber = Math.min(attempt.currentQuestion + 1, window.PGQuizService.roundSize(round));
    sessionId = sessionStorage.getItem(SESSION_KEY) || "";
    if (sessionId) {
      try {
        const result = await resumeIfPresent();
        applyServerIdentity(attempt, result);
        await syncAttempt(attempt);
        return;
      } catch (error) {
        if (![401, 404, 409].includes(error.status) && !error.retryable) throw error;
        sessionId = "";
        sessionStorage.removeItem(SESSION_KEY);
        if (error.status === 409) {
          sessionStorage.removeItem(START_REQUEST_KEY);
        }
        if (error.retryable) throw error;
        if (error.status === 401) {
          sessionStorage.removeItem(SESSION_KEY);
        }
      }
    }
    let startRequestId = sessionStorage.getItem(START_REQUEST_KEY) || "";
    if (!startRequestId) {
      startRequestId = newId();
      sessionStorage.setItem(START_REQUEST_KEY, startRequestId);
    }
    const result = await post(`${API}/sessions`, {
      startRequestId,
      participant: {
        fullName: attempt.participant.fullName,
        college: attempt.participant.college,
        email: attempt.participant.email,
        phone: attempt.participant.phone || "",
        department: attempt.participant.department,
        year: attempt.participant.year
      },
      round,
      questionNumber
    });
    sessionId = result.quizSessionId;
    sessionStorage.setItem(SESSION_KEY, sessionId);
    applyServerIdentity(attempt, result);
    await syncAttempt(attempt);
  }

  function start(attempt, onIdentity) {
    if (!attempt || attempt.status !== "In Progress" || active || finishing) return Promise.resolve();
    identityHandler = typeof onIdentity === "function" ? onIdentity : null;
    pendingAttempt = attempt;
    attachListeners();
    if (startPromise) return startPromise;
    if (startRetry) {
      window.clearTimeout(startRetry);
      startRetry = 0;
    }
    startPromise = establishSession(attempt).then(() => {
      startRetryCount = 0;
      if (statusHandler) statusHandler(null);
      activate();
    }).catch(error => {
      reportError(error);
      scheduleStartRetry(error);
    }).finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  function onOnline() {
    if (!active && pendingAttempt) start(pendingAttempt);
    if (latestAttempt) syncAttempt(latestAttempt);
    if (attemptSyncRetry) {
      window.clearTimeout(attemptSyncRetry);
      attemptSyncRetry = 0;
    }
    if (eventRetry) {
      window.clearTimeout(eventRetry);
      eventRetry = 0;
    }
    flushEvents();
  }

  function maybeReturned() {
    if (!active || hidden || !focused || !inactive) return;
    inactive = false;
    sendEvent("RETURNED");
  }

  function onVisibilityChange() {
    hidden = document.visibilityState !== "visible";
    if (hidden) {
      inactive = true;
      sendEvent("TAB_HIDDEN", true);
    } else {
      if (!active && pendingAttempt) start(pendingAttempt);
      maybeReturned();
      flushEvents();
    }
  }

  function onBlur() {
    focused = false;
    inactive = true;
    sendEvent("WINDOW_BLUR", true);
  }

  function onFocus() {
    focused = true;
    maybeReturned();
  }

  function onPageHide() {
    sendEvent("PAGE_HIDDEN", true);
  }

  function onFullscreenChange() {
    const fullscreenNow = Boolean(document.fullscreenElement);
    if (fullscreenActive && !fullscreenNow) sendEvent("FULLSCREEN_EXIT");
    fullscreenActive = fullscreenNow;
  }

  function updateProgress(attempt) {
    if (!active || !attempt || attempt.status !== "In Progress") return;
    round = attempt.currentRound;
    questionNumber = Math.min(attempt.currentQuestion + 1, window.PGQuizService.roundSize(round));
    syncAttempt(attempt);
    sendEvent("QUIZ_PROGRESS");
  }

  async function finish(attempt) {
    if (!active || !attempt) return;
    round = attempt.currentRound;
    questionNumber = Math.min(attempt.currentQuestion + 1, window.PGQuizService.roundSize(round));
    finishing = true;
    clearInterval(heartbeat);
    heartbeat = 0;
    if (startRetry) clearTimeout(startRetry);
    pendingAttempt = null;
    syncAttempt(attempt);
    await Promise.race([
      sendEvent("QUIZ_COMPLETED"),
      new Promise(resolve => window.setTimeout(() => resolve(false), 1500))
    ]);
    active = false;
    finalizeSession();
  }

  function finalizeSession() {
    if (!finishing || pendingEvents.length || latestAttempt || attemptSyncPromise || attemptSyncRetry) return;
    finishing = false;
    if (eventRetry) window.clearTimeout(eventRetry);
    eventRetry = 0;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(START_REQUEST_KEY);
    sessionId = "";
  }

  function adminSnapshot() {
    return fetch("/api/admin/monitor/snapshot", { credentials: "same-origin" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load live monitoring.");
      return result;
    });
  }

  function subscribeAdmin(onUpdate, onError, onOpen) {
    const stream = new EventSource("/api/admin/monitor/stream", { withCredentials: true });
    stream.addEventListener("monitor", event => {
      try { onUpdate(JSON.parse(event.data)); }
      catch (error) { onError(error); }
    });
    stream.onopen = () => {
      if (onOpen) onOpen();
    };
    stream.onerror = () => onError(new Error("Live monitoring connection interrupted; reconnecting."));
    return () => stream.close();
  }

  function setStatusHandler(handler) {
    statusHandler = typeof handler === "function" ? handler : null;
  }
  window.PGMonitoringService = Object.freeze({
    start, updateProgress, syncAttempt, finish, adminSnapshot, subscribeAdmin,
    setStatusHandler
  });
})();
