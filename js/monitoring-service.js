/* Same-origin monitoring API; event timestamps and records are server-owned. */
(function () {
  const SESSION_KEY = "phishguard.monitor.session.v1";
  const API = "/api/monitor";
  let active = false;
  let sessionId = "";
  let round = 1;
  let questionNumber = 1;
  let hidden = document.visibilityState !== "visible";
  let focused = document.hasFocus();
  let inactive = hidden || !focused;
  let fullscreenActive = Boolean(document.fullscreenElement);
  let heartbeat = 0;
  let listenersAttached = false;

  async function post(path, payload, keepalive = false) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Monitoring service request failed.");
    return result;
  }

  function reportError(error) {
    console.error("Quiz monitoring could not be synchronized:", error);
  }

  function context(eventType) {
    return { quizSessionId: sessionId, eventType, round, questionNumber };
  }

  function sendEvent(eventType, keepalive = false) {
    if (!active || !sessionId) return Promise.resolve(null);
    return post(`${API}/events`, context(eventType), keepalive).catch(error => {
      reportError(error);
      return null;
    });
  }

  function resumeIfPresent() {
    if (!sessionId) return Promise.resolve(false);
    return post(`${API}/sessions/${encodeURIComponent(sessionId)}/resume`, { round, questionNumber })
      .then(() => true)
      .catch(error => {
        if (error.message.includes("not found") || error.message.includes("unavailable")) {
          sessionStorage.removeItem(SESSION_KEY);
          sessionId = "";
          return false;
        }
        reportError(error);
        return false;
      });
  }

  async function start(attempt) {
    if (!attempt || attempt.status !== "In Progress") return;
    round = attempt.currentRound;
    questionNumber = Math.min(attempt.currentQuestion + 1, window.PGQuizService.roundSize(round));
    try {
      sessionId = sessionStorage.getItem(SESSION_KEY) || "";
      const resumed = await resumeIfPresent();
      if (!resumed) {
        const result = await post(`${API}/sessions`, {
          participantId: attempt.id,
          participant: {
            fullName: attempt.participant.fullName,
            college: attempt.participant.college,
            email: attempt.participant.email,
            department: attempt.participant.department,
            year: attempt.participant.year
          },
          round,
          questionNumber
        });
        sessionId = result.quizSessionId;
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }
      active = true;
      hidden = document.visibilityState !== "visible";
      focused = document.hasFocus();
      inactive = hidden || !focused;
      fullscreenActive = Boolean(document.fullscreenElement);
      attachListeners();
      await sendEvent("QUIZ_PROGRESS");
      heartbeat = window.setInterval(() => {
        if (!hidden && focused) sendEvent("QUIZ_PROGRESS");
      }, 15000);
      if (inactive) {
        if (hidden) await sendEvent("TAB_HIDDEN");
        if (!focused) await sendEvent("WINDOW_BLUR");
      }
    } catch (error) {
      reportError(error);
    }
  }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("pagehide", onPageHide);
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
      maybeReturned();
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

  function onFullscreenChange() {
    const fullscreenNow = Boolean(document.fullscreenElement);
    if (fullscreenActive && !fullscreenNow) sendEvent("FULLSCREEN_EXIT");
    fullscreenActive = fullscreenNow;
  }

  function onPageHide() {
    sendEvent("PAGE_HIDDEN", true);
  }

  function updateProgress(attempt) {
    if (!active || !attempt || attempt.status !== "In Progress") return;
    round = attempt.currentRound;
    questionNumber = Math.min(attempt.currentQuestion + 1, window.PGQuizService.roundSize(round));
    sendEvent("QUIZ_PROGRESS");
  }

  async function finish(attempt) {
    if (!active || !attempt) return;
    round = attempt.currentRound;
    questionNumber = Math.min(attempt.currentQuestion + 1, window.PGQuizService.roundSize(round));
    await sendEvent("QUIZ_COMPLETED");
    active = false;
    clearInterval(heartbeat);
    sessionStorage.removeItem(SESSION_KEY);
    sessionId = "";
  }

  function adminSnapshot() {
    return fetch("/api/admin/monitor/snapshot", { credentials: "same-origin" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load live monitoring.");
      return result;
    });
  }

  function subscribeAdmin(onUpdate, onError) {
    const stream = new EventSource("/api/admin/monitor/stream", { withCredentials: true });
    stream.addEventListener("monitor", event => {
      try { onUpdate(JSON.parse(event.data)); }
      catch (error) { onError(error); }
    });
    stream.onerror = () => onError(new Error("Live monitoring connection interrupted; reconnecting."));
    return () => stream.close();
  }

  window.PGMonitoringService = Object.freeze({ start, updateProgress, finish, adminSnapshot, subscribeAdmin });
})();
