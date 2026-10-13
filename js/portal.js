/* Participant competition and organizer portal UI. */
(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ACTIVE_KEY = "phishguard.active.attempt.v1";
  const MAIN_COMPLETION_KEY = "phishguard.main-completed.v1";
  const RAPID_FINAL_KEY = "phishguard.rapid-final.active.v1";
  const RAPID_FINAL_API = "/api/rapid-final";
  let attempt = null;
  let answerLocked = false;
  let verifiedCompletionResult = null;
  let stopMonitoringStream = null;
  let monitoringGeneration = 0;
  let monitoringParticipants = new Map();
  let monitoringEvents = [];
  let centralAttempts = new Map();
  let rapidAuthorized = false;
  let rapidTimerId = 0;
  let rapidRetryTimer = 0;
  let rapidDeadlineMono = 0;
  let rapidQuestionIndex = -1;
  let rapidPendingSubmission = null;
  let rapidCountdownTimer = 0;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  }
  function setText(selector, value) { $(selector).textContent = value; }
  function report(selector, message) { setText(selector, message); }
  window.PGPortalCanOpenRapidFinal = () => rapidAuthorized;
  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }
  PGMonitoringService.setStatusHandler(error => {
    const status = $("#monitoringSyncStatus");
    status.hidden = !error;
    status.textContent = error
      ? `Live sync is unavailable; the admin may not see this participant yet. Open the symposium Web Service URL and check the connection. ${error.message}`
      : "";
  });
  function activeAttemptId() {
    try { return sessionStorage.getItem(ACTIVE_KEY); }
    catch (error) { return null; }
  }

  function showCurrentQuestion() {
    const question = PGQuizService.questionAt(attempt);
    if (!question) {
      report("#contestNext", "Unable to load this question. Please return to the organizer.");
      return;
    }
    answerLocked = false;
    const round = attempt.currentRound;
    const number = attempt.currentQuestion + 1;
    const total = PGQuizService.roundSize(round);
    setText("#contestRound", round === 3 ? "FINAL ROUND" : "ROUND " + round);
    setText("#contestNow", number);
    setText("#contestTotal", total);
    setText("#contestProgress", (PGQuizService.overallIndex(attempt) + 1) + " / " + attempt.totalQuestions);
    $("#contestBar").style.width = ((number - 1) / total * 100) + "%";
    $("#contestStage").innerHTML = `<p class="eyebrow">${esc(question.category.toUpperCase())} · ${esc(question.title)}</p>${renderScenario(question)}`;
    const hint = PGQuizService.hintFor(question);
    $("#showContestHint").hidden = !hint;
    $("#contestHint").hidden = !hint;
    $("#contestHint").textContent = hint ? `CLUE: ${hint}` : "";
    $("#contestHint").classList.remove("is-visible");
    $("#showContestHint").setAttribute("aria-expanded", "false");
    $("#contestNext").innerHTML = "";
    $("#contestLegit").disabled = false;
    $("#contestPhish").disabled = false;
    PGMonitoringService.updateProgress(attempt);
    go("contest-quiz");
  }

  function startAttempt(saved) {
    attempt = saved;
    sessionStorage.setItem(ACTIVE_KEY, attempt.id);
    PGMonitoringService.start(attempt, participantId => sessionStorage.setItem(ACTIVE_KEY, participantId));
    showCurrentQuestion();
  }

  function resumeActiveAttempt() {
    const id = activeAttemptId();
    if (!id) return false;
    try {
      const saved = PGParticipantService.get(id);
      if (saved && saved.status === "In Progress") {
        startAttempt(saved);
        return true;
      }
      sessionStorage.removeItem(ACTIVE_KEY);
    } catch (error) {
      report("#participantError", "Could not restore your saved attempt: " + error.message);
    }
    return false;
  }
  window.PGPortalResume = resumeActiveAttempt;

  function openTransition(round) {
    if (round === 1) {
      setText("#transitionEyebrow", "ROUND 1 COMPLETED");
      setText("#transitionTitle", "Get ready for Round 2");
      setText("#transitionDescription", "15 intermediate questions remain.");
      setText("#startNextRound", "START ROUND 2 →");
    } else {
      setText("#transitionEyebrow", "ROUND 2 COMPLETED");
      setText("#transitionTitle", "Final Round");
      setText("#transitionDescription", "10 advanced questions remain.");
      setText("#startNextRound", "START FINAL ROUND →");
    }
    go("round-transition");
  }

  function acceptCompletion(submittedAttempt, result) {
    submittedAttempt.score = result.score;
    submittedAttempt.roundScores = result.roundScores;
    submittedAttempt.accuracy = result.accuracy;
    submittedAttempt.resultReview = result.review;
    attempt = PGParticipantService.save(submittedAttempt);
    renderCompletionReview(attempt);
    renderRapidEligibility(result);
    setText("#completedAttemptId", attempt.id);
    sessionStorage.removeItem(ACTIVE_KEY);
    sessionStorage.setItem(MAIN_COMPLETION_KEY, "1");
    attempt = null;
    verifiedCompletionResult = null;
    go("completion");
  }

  async function verifyCompletion(submittedAttempt) {
    $("#completionRetry").hidden = true;
    setText("#completedAttemptId", submittedAttempt.id);
    try {
      const result = verifiedCompletionResult || await PGMonitoringService.finish(submittedAttempt);
      if (!result || !Array.isArray(result.review) || result.review.length + result.score !== 40 ||
          typeof result.rapidFinalEligible !== "boolean" ||
          !Number.isFinite(result.mainPercentage)) {
        throw new Error("The server did not return a complete verified quiz result.");
      }
      verifiedCompletionResult = result;
      acceptCompletion(submittedAttempt, result);
    } catch (error) {
      report("#completionError", "Your answers were saved, but the server could not verify the final result. Please retry without closing this page. " + error.message);
      $("#completionRetry").hidden = false;
      go("completion");
    }
  }

  async function nextQuestion() {
    if (attempt.currentQuestion < PGQuizService.roundSize(attempt.currentRound)) {
      showCurrentQuestion();
    } else if (attempt.currentRound < 3) {
      openTransition(attempt.currentRound);
    } else {
      attempt = PGParticipantService.finish(attempt);
      await verifyCompletion(attempt);
    }
  }

  $("#completionRetry").addEventListener("click", async () => {
    if (!attempt) return;
    $("#completionRetry").disabled = true;
    try {
      const saved = PGParticipantService.save(attempt);
      await verifyCompletion(saved);
    } finally {
      $("#completionRetry").disabled = false;
    }
  });

  function selectAnswer(choice) {
    if (!attempt || answerLocked) return;
    try {
      attempt = PGQuizService.saveAnswer(attempt, choice);
      answerLocked = true;
      $("#contestLegit").disabled = true;
      $("#contestPhish").disabled = true;
      const last = attempt.currentQuestion === PGQuizService.roundSize(attempt.currentRound);
      const label = last && attempt.currentRound === 3 ? "SUBMIT QUIZ →" : "NEXT QUESTION →";
      $("#contestNext").innerHTML = `<div class="next-row"><button class="btn btn-primary" id="contestContinue">${label}</button></div>`;
      $("#contestContinue").focus();
      $("#contestContinue").addEventListener("click", nextQuestion, { once: true });
    } catch (error) {
      report("#contestNext", "Your answer could not be saved. Please try again. " + error.message);
    }
  }

  $("#contestLegit").addEventListener("click", () => selectAnswer("legitimate"));
  $("#contestPhish").addEventListener("click", () => selectAnswer("phishing"));
  $("#startNextRound").addEventListener("click", () => {
    if (!attempt) return;
    attempt.currentRound++;
    attempt.currentQuestion = 0;
    PGParticipantService.save(attempt);
    showCurrentQuestion();
  });
  $("#showContestHint").addEventListener("click", () => {
    if ($("#contestHint").hidden) return;
    const visible = $("#contestHint").classList.toggle("is-visible");
    $("#showContestHint").setAttribute("aria-expanded", String(visible));
  });
  $("#rapidAccessButton").addEventListener("click", async () => {
    const button = $("#rapidAccessButton");
    button.disabled = true;
    try {
      const status = await rapidRequest("/status");
      if (!status.eligible) {
        renderRapidEligibility({
          rapidFinalEligible: false,
          mainPercentage: status.mainPercentage
        });
        return;
      }
      rapidAuthorized = true;
      if (status.status === "in_progress" || status.status === "completed") {
        const state = await rapidRequest("/state");
        reconcileRapidResponse(state);
        return;
      }
      setText("#rapidAccessDescription",
        `Main assessment verified at ${status.mainPercentage.toFixed(1)}%. The launch delay is active; no challenge time runs until server launch.`);
      setText("#rapidLaunchCount", "03");
      $("#rapidLaunchButton").disabled = true;
      $("#rapidLaunchButton").textContent = "INITIALIZING SECURE SESSION";
      go("rapid-access");
      if (rapidCountdownTimer) window.clearInterval(rapidCountdownTimer);
      let count = 3;
      rapidCountdownTimer = window.setInterval(() => {
        count--;
        setText("#rapidLaunchCount", String(Math.max(0, count)).padStart(2, "0"));
        if (count <= 0) {
          window.clearInterval(rapidCountdownTimer);
          rapidCountdownTimer = 0;
          $("#rapidLaunchButton").disabled = false;
          $("#rapidLaunchButton").textContent = "ENTER RAPID FINAL";
        }
      }, 1000);
    } catch (error) {
      report("#rapidEligibilityText", `Eligibility could not be verified by the server: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
  $("#rapidLaunchButton").addEventListener("click", async () => {
    const button = $("#rapidLaunchButton");
    button.disabled = true;
    button.textContent = "OPENING SECURE CHANNEL…";
    try {
      const state = await rapidRequest("/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      rapidAuthorized = true;
      sessionStorage.setItem(RAPID_FINAL_KEY, "1");
      reconcileRapidResponse(state);
    } catch (error) {
      setText("#rapidAccessDescription",
        `Secure launch could not be confirmed: ${error.message}. Retry safely; if the request reached the server, its timer will not reset.`);
      button.disabled = false;
      button.textContent = "RETRY SECURE LAUNCH";
    }
  });
  $("#rapidQuestionPanel").addEventListener("click", event => {
    const option = event.target.closest("[data-rapid-choice]");
    if (option && !option.disabled) submitRapidAnswer(Number(option.dataset.rapidChoice));
  });

  function renderCompletionReview(record) {
    const review = record.resultReview || [];
    const scores = record.roundScores || {};
    setText("#completionScore", `${record.score} / 40`);
    setText("#completionRoundScores",
      `Round 1: ${scores[1]} / 15 · Round 2: ${scores[2]} / 15 · Final Round: ${scores[3]} / 10`);
    $("#completionError").textContent = "";
    if (!review.length) {
      $("#completionReview").innerHTML = `<p class="lede">Outstanding work — you answered all 40 questions correctly.</p>`;
      return;
    }

    const byId = new Map(QUESTIONS.map(question => [question.id, question]));
    $("#completionReview").innerHTML = [1, 2, 3].map(round => {
      const items = review.filter(item => item.round === round);
      if (!items.length) return "";
      const title = round === 3 ? "Final Round" : `Round ${round}`;
      return `<section class="card" style="margin-top:16px"><h3>${title} — ${items.length} to review</h3>
        ${items.map(item => {
          const question = byId.get(item.questionId);
          return `<article class="card" style="margin-top:12px">
            <p class="eyebrow">${esc(question ? question.title : item.questionId)}</p>
            ${question ? renderScenario(question) : ""}
            <p><b>Your answer:</b> ${esc(item.choice)}</p>
            <p><b>Correct answer:</b> ${esc(item.correctAnswer)}</p>
            <p>${esc(item.explanation)}</p>
          </article>`;
        }).join("")}</section>`;
    }).join("");
  }

  function renderRapidEligibility(result) {
    const panel = $("#rapidEligibility");
    panel.hidden = false;
    const percent = Number(result.mainPercentage);
    const eligible = result.rapidFinalEligible === true && percent >= 95;
    rapidAuthorized = eligible;
    setText("#rapidEligibilityTitle", eligible ? "ELITE ACCESS VERIFIED" : "ASSESSMENT COMPLETE");
    setText("#rapidEligibilityText", eligible
      ? `Your server-verified main score is ${percent.toFixed(1)}%. You qualify for RAPID FINAL, a separate five-question tie-breaker.`
      : `Your server-verified main score is ${Number.isFinite(percent) ? percent.toFixed(1) : "—"}%. RAPID FINAL requires at least 95%; your main-quiz result remains recorded.`);
    $("#rapidAccessButton").hidden = !eligible;
  }

  function restoreMainCompletion(status) {
    renderCompletionReview({
      score: status.mainScore,
      roundScores: status.mainRoundScores,
      resultReview: status.mainReview
    });
    setText("#completedAttemptId", status.participantId);
    renderRapidEligibility({
      rapidFinalEligible: status.eligible,
      mainPercentage: status.mainPercentage
    });
    go("completion");
  }

  async function rapidRequest(path, options = {}) {
    const response = await fetch(`${RAPID_FINAL_API}${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...options
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || "RAPID FINAL could not be reached.");
      error.status = response.status;
      error.result = result;
      throw error;
    }
    return result;
  }

  function stopRapidTimer() {
    if (rapidTimerId) window.clearInterval(rapidTimerId);
    rapidTimerId = 0;
  }

  function showRapidCompletion(state) {
    stopRapidTimer();
    if (rapidRetryTimer) window.clearTimeout(rapidRetryTimer);
    rapidRetryTimer = 0;
    rapidPendingSubmission = null;
    sessionStorage.setItem(RAPID_FINAL_KEY, "1");
    setText("#rapidFinalScore", `${state.score} / 5`);
    setText("#rapidResultStatus", "Five-question tie-breaker submitted and sealed.");
    setText("#rapidResultNote", "Correct answers and response-time analysis are available only to the authenticated organizer.");
    go("rapid-completion");
  }

  function renderRapidQuestion(state) {
    if (!state || state.status !== "in_progress" || !state.question) {
      if (state && state.status === "completed") showRapidCompletion(state);
      else report("#rapidFeedback", "The secure challenge state is unavailable. Reconnect to resume your server-timed attempt.");
      return;
    }
    rapidAuthorized = true;
    sessionStorage.setItem(RAPID_FINAL_KEY, "1");
    stopRapidTimer();
    if (rapidRetryTimer) window.clearTimeout(rapidRetryTimer);
    rapidRetryTimer = 0;
    rapidPendingSubmission = null;
    rapidQuestionIndex = state.questionIndex;
    $("#rapidQuestionCount").textContent =
      `QUESTION ${String(state.questionIndex + 1).padStart(2, "0")} / 05`;
    $("#rapidProgressBar").style.width = `${state.questionIndex / 5 * 100}%`;
    $("#rapidFeedback").textContent = "";
    $("#rapidQuestionPanel").innerHTML = `
      <h3>${esc(state.question.title)}</h3>
      <div class="rapid-scenario">${esc(state.question.scenario)}</div>
      <div class="rapid-options" role="group" aria-label="Choose one response">
        ${state.question.options.map((option, index) => `
          <button class="rapid-option" type="button" data-rapid-choice="${index}">
            <b>${String.fromCharCode(65 + index)}</b><span>${esc(option)}</span>
          </button>`).join("")}
      </div>`;
    const leftMs = Math.max(0, state.deadlineAt - state.serverNow);
    rapidDeadlineMono = performance.now() + leftMs;
    const timer = $("#rapidTimer");
    const tick = () => {
      const remaining = Math.max(0, rapidDeadlineMono - performance.now());
      const seconds = Math.ceil(remaining / 1000);
      timer.textContent = String(seconds).padStart(2, "0");
      timer.classList.toggle("low", seconds <= 10 && seconds > 5);
      timer.classList.toggle("critical", seconds <= 5);
      if (remaining <= 0) submitRapidAnswer(null);
    };
    tick();
    rapidTimerId = window.setInterval(tick, 100);
    go("rapid-challenge");
  }

  function reconcileRapidResponse(state) {
    if (state.status === "completed") showRapidCompletion(state);
    else if (state.status === "in_progress") renderRapidQuestion(state);
    else report("#rapidFeedback", "The server did not return an active RAPID FINAL question.");
  }

  async function sendRapidSubmission() {
    if (!rapidPendingSubmission) return;
    try {
      const response = await fetch(`${RAPID_FINAL_API}/answer`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rapidPendingSubmission)
      });
      const result = await response.json();
      if (response.status === 409 && result.state) {
        reconcileRapidResponse(result.state);
        return;
      }
      if (!response.ok) {
        const error = new Error(result.error || "Answer submission failed.");
        error.status = response.status;
        throw error;
      }
      reconcileRapidResponse(result);
    } catch (error) {
      if ([400, 401, 403, 404].includes(error.status)) {
        report("#rapidFeedback", `Secure submission stopped: ${error.message}`);
        if (error.status === 403 || error.status === 404) sessionStorage.removeItem(RAPID_FINAL_KEY);
        return;
      }
      report("#rapidFeedback", "Connection interrupted; the server timer continues. Reconnecting to the same question…");
      rapidRetryTimer = window.setTimeout(sendRapidSubmission, 1200);
    }
  }

  function submitRapidAnswer(choiceIndex) {
    if (rapidPendingSubmission || rapidQuestionIndex < 0) return;
    stopRapidTimer();
    $("#rapidQuestionPanel").querySelectorAll("[data-rapid-choice]")
      .forEach(button => { button.disabled = true; });
    report("#rapidFeedback", choiceIndex === null
      ? "TIME EXPIRED // ANSWER RECORDED AS UNANSWERED"
      : "RESPONSE SEALED // VERIFYING WITH SERVER");
    rapidPendingSubmission = {
      questionIndex: rapidQuestionIndex,
      choiceIndex,
      requestId: crypto.randomUUID()
    };
    sendRapidSubmission();
  }

  async function resumeRapidFinal() {
    const rapidSessionExists = sessionStorage.getItem(RAPID_FINAL_KEY) === "1";
    const mainCompletionExists = sessionStorage.getItem(MAIN_COMPLETION_KEY) === "1";
    if (!rapidSessionExists && !mainCompletionExists) return;
    try {
      const status = await rapidRequest("/status");
      if (!status.eligible) {
        sessionStorage.removeItem(RAPID_FINAL_KEY);
        if (mainCompletionExists) restoreMainCompletion(status);
        return;
      }
      rapidAuthorized = true;
      if (mainCompletionExists) restoreMainCompletion(status);
      if (status.status === "in_progress" || status.status === "completed") {
        sessionStorage.setItem(RAPID_FINAL_KEY, "1");
        const state = await rapidRequest("/state");
        reconcileRapidResponse(state);
      } else if (mainCompletionExists) {
        go("completion");
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        sessionStorage.removeItem(RAPID_FINAL_KEY);
        sessionStorage.removeItem(MAIN_COMPLETION_KEY);
        return;
      }
      if (rapidSessionExists) {
        report("#rapidFeedback", "Restoring your secure RAPID FINAL session…");
        go("rapid-challenge");
      } else {
        report("#completionError", "Your verified results are safe. Eligibility could not be refreshed; reconnect to retry. " + error.message);
        go("completion");
      }
      rapidRetryTimer = window.setTimeout(resumeRapidFinal, 1500);
    }
  }

  $("#participantForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const details = {
      fullName: String(values.fullName || "").trim(),
      college: String(values.college || "").trim(),
      email: String(values.email || "").trim(),
      phone: String(values.phone || "").trim(),
      year: String(values.year || "").trim(),
      department: String(values.department || "").trim()
    };
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email);
    const phoneDigits = details.phone.replace(/\D/g, "");
    const phoneFormatValid = /^\+?[\d\s().-]+$/.test(details.phone);
    const years = ["I Year", "II Year", "III Year", "IV Year"];
    if (!details.fullName || !details.college || !details.email || !details.phone || !details.year || !details.department) {
      report("#participantError", "Please complete all required fields.");
      return;
    }
    if (!emailValid) {
      report("#participantError", "Enter a valid email address.");
      return;
    }
    if (!phoneFormatValid || phoneDigits.length < 7 || phoneDigits.length > 15) {
      report("#participantError", "Enter a valid phone number with 7 to 15 digits.");
      return;
    }
    if (!years.includes(details.year)) {
      report("#participantError", "Select one of the available study years.");
      return;
    }
    try {
      attempt = PGParticipantService.create(details, PGQuizService.selectQuestions());
      report("#participantError", "");
      startAttempt(attempt);
    } catch (error) {
      report("#participantError", "Unable to save your participant details. " + error.message);
    }
  });

  $("#adminLoginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      if (!await PGAuthService.login(String(fields.get("adminId") || "").trim(), String(fields.get("password") || ""))) {
        report("#adminLoginError", "Admin ID or password is incorrect.");
        return;
      }
      if (form && typeof form.reset === "function") form.reset();
      report("#adminLoginError", "");
      renderDashboard();
      go("admin");
      startLiveMonitoring();
    } catch (error) {
      report("#adminLoginError", error.message === "Admin ID or password is incorrect."
        ? error.message : "Admin login is unavailable: " + error.message);
    }
  });

  function scoreFor(record) {
    if (record.status === "Completed" && Number.isFinite(record.score)) return record.score;
    return PGQuizService.score(record).total;
  }
  function attempts() { return [...centralAttempts.values()]; }
  function updateFilterOptions(records) {
    [["#filterCollege", "college", "All colleges"], ["#filterDepartment", "department", "All departments"]]
      .forEach(([selector, key, label]) => {
        const select = $(selector);
        const previous = select.value;
        const values = [...new Set(records.map(item => item.participant[key]).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        select.innerHTML = `<option value="">${label}</option>` + values.map(value =>
          `<option value="${esc(value)}">${esc(value)}</option>`).join("");
        select.value = values.includes(previous) ? previous : "";
      });
  }
  function visibleAttempts(records) {
    const query = $("#adminSearch").value.trim().toLocaleLowerCase();
    const college = $("#filterCollege").value;
    const department = $("#filterDepartment").value;
    const year = $("#filterYear").value;
    const status = $("#filterStatus").value;
    const results = records.filter(record => {
      const person = record.participant;
      const searchable = [record.id, person.fullName, person.college, person.email, person.phone,
        person.department, person.year].join(" ").toLocaleLowerCase();
      return (!query || searchable.includes(query)) &&
        (!college || person.college === college) &&
        (!department || person.department === department) &&
        (!year || person.year === year) &&
        (!status || record.status === status);
    });
    const sort = $("#sortParticipants").value;
    results.sort((a, b) => {
      if (sort === "score-desc") return scoreFor(b) - scoreFor(a);
      if (sort === "score-asc") return scoreFor(a) - scoreFor(b);
      if (sort === "name") return a.participant.fullName.localeCompare(b.participant.fullName);
      return b.startedAt.localeCompare(a.startedAt);
    });
    return results;
  }
  function renderDashboard() {
    if (!PGAuthService.isAuthenticated()) return;
    try {
      const records = attempts();
      const completed = records.filter(item => item.status === "Completed");
      const average = completed.length
        ? (completed.reduce((sum, item) => sum + item.score, 0) / completed.length).toFixed(1)
        : "—";
      setText("#adminTotal", records.length);
      setText("#adminCompleted", completed.length);
      setText("#adminProgress", records.length - completed.length);
      setText("#adminAverage", average);
      updateFilterOptions(records);
      const visible = visibleAttempts(records);
      setText("#adminCount", `Showing ${visible.length} of ${records.length} participants`);
      $("#participantRows").innerHTML = visible.length ? visible.map(record => {
        const p = record.participant;
        const score = scoreFor(record);
        const accuracy = record.answers.length ? Math.round(score / record.totalQuestions * 100) + "%" : "—";
        const rapid = record.rapidFinal || {};
        const rapidStatus = !rapid.eligible ? "Not eligible" :
          rapid.status === "completed" ? `Completed · #${rapid.ranking || "TIE"}` :
            rapid.status === "in_progress" ? "In progress" : "Eligible · not started";
        return `<tr>
          <td><button class="link-button" data-participant="${esc(record.id)}">${esc(record.id)}</button></td>
          <td>${esc(p.fullName)}</td><td>${esc(p.college)}</td>
          <td><a href="mailto:${encodeURIComponent(p.email)}">${esc(p.email)}</a></td>
          <td>${esc(p.phone)}</td><td>${esc(p.year)}</td><td>${esc(p.department)}</td>
          <td>${score}/${record.totalQuestions}</td><td>${accuracy}</td><td>${esc(rapidStatus)}</td>
          <td><span class="status ${record.status === "Completed" ? "done" : "pending"}">${esc(record.status)}</span></td>
        </tr>`;
      }).join("") : `<tr><td colspan="11" class="empty">No participants match these filters.</td></tr>`;
      const rankingRecords = records.filter(record => record.rapidFinal?.eligible)
        .sort((left, right) => {
          if (left.rapidFinal.ranking == null) return right.rapidFinal.ranking == null ? 0 : 1;
          if (right.rapidFinal.ranking == null) return -1;
          return left.rapidFinal.ranking - right.rapidFinal.ranking;
        });
      $("#rapidRankingRows").innerHTML = rankingRecords.length ? rankingRecords.map(record => {
        const rapid = record.rapidFinal;
        const rankLabel = rapid.status !== "completed" ? "—" :
          rapid.isTied ? `TIE · ${rapid.ranking}` : String(rapid.ranking);
        const correctTime = rapid.status === "completed"
          ? `${(rapid.totalCorrectResponseMs / 1000).toFixed(2)} s` : "—";
        return `<tr><td>${rankLabel}</td><td>${esc(record.participant.fullName)}</td>
          <td>${rapid.mainPercentage.toFixed(1)}%</td><td>ELIGIBLE</td>
          <td>${esc(rapid.status.replace("_", " "))}</td><td>${rapid.score == null ? "—" : `${rapid.score} / 5`}</td>
          <td>${correctTime}</td><td>${rapid.combinedScore == null ? "—" : `${rapid.combinedScore} / 45`}</td></tr>`;
      }).join("") : `<tr><td colspan="8" class="empty">No 95%+ qualifiers yet.</td></tr>`;
      report("#adminError", "");
    } catch (error) {
      $("#participantRows").innerHTML = `<tr><td colspan="11" class="empty">Could not load participant data: ${esc(error.message)}</td></tr>`;
      report("#adminCount", "Storage error");
    }
  }

  function activityLabel(event) {
      if (event.event_type === "TAB_HIDDEN") return "LEFT QUIZ TAB";
      if (event.event_type === "WINDOW_BLUR") return "QUIZ WINDOW LOST FOCUS";
      if (event.event_type === "RETURNED") {
        return `RETURNED${event.duration_seconds == null ? "" : ` · INACTIVE ${event.duration_seconds}s`}`;
      }
      if (event.event_type === "FULLSCREEN_EXIT") return "EXITED FULLSCREEN";
      if (event.event_type === "SESSION_STARTED") return "QUIZ STARTED";
      if (event.event_type === "QUIZ_COMPLETED") return "QUIZ COMPLETED";
      if (event.event_type === "PAGE_RESUMED") return "QUIZ RESUMED";
      if (event.event_type === "PAGE_HIDDEN") return "QUIZ PAGE HIDDEN";
      return "QUESTION PROGRESS";
  }

  function participantCardMarkup(person) {
      const status = person.currentStatus;
      const online = status !== "STALE";
      const attention = ["ATTENTION", "AWAY", "STALE"].includes(status);
      const statusText = online ? "ONLINE" : "OFFLINE";
      const roundName = person.round === 3 ? "Final Round" : `Round ${person.round}`;
      const total = PGQuizService.roundSize(person.round);
      const lastEvent = person.lastEvent ? activityLabel({ event_type: person.lastEvent }) : "—";
      const loginTime = person.loginTime || person.lastActivity;
      return `<article class="monitor-participant ${attention ? "needs-attention" : ""}" data-monitor-session="${esc(person.quizSessionId)}">
        <div class="monitor-card-heading">
          <span class="monitor-status ${online ? "active" : "attention"}">${online ? "🟢" : "⚪"} ${statusText}</span>
          <span class="qmeta">${esc(person.participantId)}</span>
        </div>
        <h4>${esc(person.participantName)}</h4>
        <p class="monitor-identity">${esc(person.college)} · ${esc(person.department)} · ${esc(person.year)}</p>
        <p class="monitor-identity"><a href="mailto:${encodeURIComponent(person.email)}">${esc(person.email)}</a>${person.phone ? ` · ${esc(person.phone)}` : ""}</p>
        <p class="monitor-identity">Device: ${esc(person.deviceType || "UNKNOWN")}</p>
        <p class="monitor-position">${esc(roundName)} — Question ${person.questionNumber}/${total}</p>
        <p class="monitor-last">Quiz status: ${esc(person.quizStatus)}</p>
        <div class="monitor-counts">
          <span>Tab switches <b>${person.tabSwitches}</b></span>
          <span>Focus losses <b>${person.focusLosses}</b></span>
          <span>Fullscreen exits <b>${person.fullscreenExits}</b></span>
          <span>Returns <b>${person.returns}</b></span>
        </div>
        <p class="monitor-last">Login time: ${esc(new Date(loginTime).toLocaleTimeString())}</p>
        <p class="monitor-last">Last activity: ${esc(new Date(person.lastActivity).toLocaleTimeString())}</p>
        <p class="monitor-last">Last event: ${esc(lastEvent)}</p>
      </article>`;
  }

  function renderMonitorFeed() {
      $("#monitorFeed").innerHTML = monitoringEvents.length ? monitoringEvents.slice(0, 30).map(event => {
        const warning = ["TAB_HIDDEN", "WINDOW_BLUR", "FULLSCREEN_EXIT", "PAGE_HIDDEN"].includes(event.event_type);
        return `<li class="${warning ? "monitor-warning" : ""}">
          <span class="monitor-event-type">${warning ? "⚠" : "✓"} ${esc(activityLabel(event))}</span>
          <span>${esc(event.participant_name)} · Round ${event.round}, Question ${event.question_number}</span>
          <time datetime="${esc(event.timestamp)}">${esc(new Date(event.timestamp).toLocaleTimeString())}</time>
        </li>`;
      }).join("") : `<li class="empty">No activity recorded yet.</li>`;
  }

  function renderMonitorParticipant(person) {
      const container = $("#liveParticipants");
      const template = document.createElement("template");
      template.innerHTML = participantCardMarkup(person).trim();
      const card = template.content.firstElementChild;
      const previous = monitoringParticipants.get(person.quizSessionId);
      if (previous) previous.replaceWith(card);
      else container.prepend(card);
      monitoringParticipants.set(person.quizSessionId, card);
  }

  function renderLiveMonitor(data) {
      if (data.type === "snapshot" || Array.isArray(data.participants)) {
        monitoringParticipants.clear();
        $("#liveParticipants").replaceChildren();
        for (const person of data.participants) renderMonitorParticipant(person);
        monitoringEvents = data.events || [];
        centralAttempts = new Map((data.attempts || []).map(record => [record.id, record]));
        renderMonitorFeed();
        renderDashboard();
        return;
      }
      if (data.type === "attempt-upsert" && data.attempt) {
        centralAttempts.set(data.attempt.id, data.attempt);
        renderDashboard();
        return;
      }
      if (data.type === "upsert" && data.participant) renderMonitorParticipant(data.participant);
      if (data.type === "remove") {
        const participant = monitoringParticipants.get(data.quizSessionId);
        if (participant) participant.remove();
        monitoringParticipants.delete(data.quizSessionId);
      }
      if (data.event) {
        monitoringEvents = [data.event, ...monitoringEvents.filter(item => item.event_id !== data.event.event_id)].slice(0, 50);
        renderMonitorFeed();
      }
      if (monitoringParticipants.size === 0) {
        $("#liveParticipants").innerHTML = `<p class="empty">No active participants.</p>`;
      }
  }

  function stopLiveMonitoring() {
      monitoringGeneration++;
      if (stopMonitoringStream) stopMonitoringStream();
      stopMonitoringStream = null;
      monitoringParticipants.clear();
      monitoringEvents = [];
      centralAttempts.clear();
      $("#monitorConnection").textContent = "DISCONNECTED";
      $("#monitorConnection").classList.remove("connected");
  }

  function startLiveMonitoring() {
      if (!PGAuthService.isAuthenticated()) return;
      if (stopMonitoringStream) stopMonitoringStream();
      const generation = ++monitoringGeneration;
      let authCheckInFlight = false;
      $("#monitorConnection").textContent = "CONNECTING";
      stopMonitoringStream = PGMonitoringService.subscribeAdmin(data => {
        if (generation !== monitoringGeneration || !PGAuthService.isAuthenticated()) return;
        $("#monitorConnection").textContent = "LIVE";
        $("#monitorConnection").classList.add("connected");
        renderLiveMonitor(data);
      }, error => {
        if (generation !== monitoringGeneration) return;
        const wasReconnecting = $("#monitorConnection").textContent === "RECONNECTING";
        $("#monitorConnection").textContent = "RECONNECTING";
        $("#monitorConnection").classList.remove("connected");
        if (!wasReconnecting) console.error("Admin monitoring stream:", error);
        if (!authCheckInFlight) {
          authCheckInFlight = true;
          PGAuthService.restore().then(authenticated => {
            if (!authenticated && generation === monitoringGeneration) {
              stopLiveMonitoring();
              go("admin-login");
            }
          }).catch(authError => {
            console.error("Admin session verification during stream reconnect:", authError);
          });
        }
      }, () => {
        if (generation !== monitoringGeneration) return;
        authCheckInFlight = false;
        $("#monitorConnection").textContent = "LIVE";
        $("#monitorConnection").classList.add("connected");
      });
  }

  function renderParticipantDetail(id) {
    const detail = $("#participantDetail");
    try {
      const record = centralAttempts.get(id);
      if (!record) throw new Error("Participant record was not found.");
      const p = record.participant;
      const scores = PGQuizService.score(record).roundScores;
      const score = scoreFor(record);
      const accuracy = record.answers.length ? Math.round(score / record.totalQuestions * 100) + "%" : "—";
      const answers = new Map(record.answers.map(answer => [answer.questionId, answer]));
      const answerRows = record.questionIds.map((questionId, index) => {
        const question = QUESTIONS.find(item => item.id === questionId);
        if (!question) return "";
        const saved = answers.get(questionId);
        const review = record.resultReview && record.resultReview[index];
        const round = review ? review.round : index < 15 ? 1 : index < 30 ? 2 : 3;
        const selected = saved ? saved.choice : "";
        return `<tr><td>Q${index + 1}</td><td>Round ${round === 3 ? "Final" : round}</td>
          <td>${selected ? esc(selected) : "No answer submitted"}</td>
          <td>${review ? esc(review.correctAnswer) : "—"}</td>
          <td>${review ? (review.isCorrect ? "Correct" : "Incorrect") : "—"}</td></tr>`;
      }).join("");
      const rapid = record.rapidFinal || {};
      const rapidRows = (rapid.answers || []).map((answer, index) => {
        const selected = answer.choiceIndex == null ? "Timed out / unanswered" :
          `Option ${String.fromCharCode(65 + answer.choiceIndex)}: ${answer.options[answer.choiceIndex]}`;
        const expected = answer.correctAnswer == null ? "—" :
          `Option ${String.fromCharCode(65 + answer.correctAnswer)}: ${answer.options[answer.correctAnswer]}`;
        const correctness = answer.choiceIndex == null ? "Unanswered" :
          answer.isCorrect ? "Correct" : "Incorrect";
        return `<tr><td>${index + 1}</td><td>${esc(answer.title)}</td><td>${esc(selected)}</td>
          <td>${esc(expected)}</td><td>${correctness}</td>
          <td>${(answer.responseTimeMs / 1000).toFixed(2)} s</td>
          <td>${esc(formatTime(answer.submittedAt))}</td></tr>`;
      }).join("");
      detail.innerHTML = `
        <div class="admin-heading"><div><p class="eyebrow">PARTICIPANT PROFILE</p><h2>${esc(p.fullName)}</h2></div>
          <button class="btn btn-sm" id="closeParticipantDetail">CLOSE</button></div>
        <h3>Participant information</h3>
        <div class="profile-grid">
          <p><b>Participant ID</b><span>${esc(record.id)}</span></p><p><b>Full name</b><span>${esc(p.fullName)}</span></p>
          <p><b>College name</b><span>${esc(p.college)}</span></p><p><b>Email</b><span>${esc(p.email)}</span></p>
          <p><b>Phone</b><span>${esc(p.phone)}</span></p><p><b>Year</b><span>${esc(p.year)}</span></p>
          <p><b>Department</b><span>${esc(p.department)}</span></p>
        </div>
        <h3>Quiz information</h3>
        <div class="profile-grid">
          <p><b>Start time</b><span>${esc(formatTime(record.startedAt))}</span></p>
          <p><b>Completion time</b><span>${esc(formatTime(record.completedAt))}</span></p>
          <p><b>Status</b><span>${esc(record.status)}</span></p><p><b>Total questions</b><span>${record.totalQuestions}</span></p>
          <p><b>Final score</b><span>${score} / ${record.totalQuestions}</span></p><p><b>Accuracy</b><span>${accuracy}</span></p>
        </div>
        <h3>Round performance</h3>
        <div class="grid g3 round-scores">
          <div class="tile"><b>${scores[1]} / 15</b><span>Round 1</span></div>
          <div class="tile"><b>${scores[2]} / 15</b><span>Round 2</span></div>
          <div class="tile"><b>${scores[3]} / 10</b><span>Final round</span></div>
        </div>
        <h3>RAPID FINAL · 95%+ tie-breaker</h3>
        <div class="profile-grid">
          <p><b>Main quiz percentage</b><span>${record.status === "Completed" ? `${(record.score / record.totalQuestions * 100).toFixed(1)}%` : "In progress"}</span></p>
          <p><b>Eligibility</b><span>${rapid.eligible ? "Eligible" : "Not eligible"}</span></p>
          <p><b>Challenge status</b><span>${esc(rapid.status || "not_attempted")}</span></p>
          <p><b>RAPID FINAL score</b><span>${rapid.score == null ? "—" : `${rapid.score} / 5`}</span></p>
          <p><b>Unanswered / timed out</b><span>${rapid.unansweredCount || 0}</span></p>
          <p><b>Correct-answer response time</b><span>${rapid.status === "completed" ? `${(rapid.totalCorrectResponseMs / 1000).toFixed(2)} s` : "—"}</span></p>
          <p><b>Combined score</b><span>${rapid.combinedScore == null ? "—" : `${rapid.combinedScore} / 45`}</span></p>
          <p><b>Tie-breaker rank</b><span>${rapid.ranking == null ? "—" : rapid.isTied ? `Tie at rank ${rapid.ranking}` : rapid.ranking}</span></p>
        </div>
        <p class="qmeta">Ranking: higher RAPID FINAL score, then lower total server-recorded response time on correct answers. Equal values are tied.</p>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Q</th><th>Scenario</th><th>Participant answer</th><th>Correct answer</th><th>Result</th><th>Response time</th><th>Server received</th></tr></thead>
          <tbody>${rapidRows || `<tr><td colspan="7" class="empty">No RAPID FINAL responses recorded.</td></tr>`}</tbody></table></div>
        <h3>Question-wise answer review</h3>
        <p class="qmeta">Correct-answer review is visible only in the admin portal.</p>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>Question</th><th>Round</th><th>Participant answer</th><th>Correct answer</th><th>Result</th></tr></thead>
          <tbody>${answerRows}</tbody></table></div>`;
      detail.hidden = false;
      detail.scrollIntoView({ behavior: "smooth", block: "start" });
      $("#closeParticipantDetail").addEventListener("click", () => { detail.hidden = true; });
    } catch (error) {
      detail.hidden = false;
      detail.textContent = "Could not load participant details: " + error.message;
    }
  }

  function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function downloadCsv(name, rows) {
    const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportResults() {
    try {
      const records = attempts();
      const rows = [["Participant ID", "Name", "College", "Email", "Phone", "Year", "Department",
        "Round 1 Score", "Round 2 Score", "Final Round Score", "Total Score", "Accuracy", "Status",
        "Start Time", "Completion Time", "RAPID Eligible", "RAPID Status", "RAPID Score",
        "Correct Response Time ms", "Combined Score / 45", "RAPID Rank"]];
      records.forEach(record => {
        const score = PGQuizService.score(record);
        rows.push([record.id, record.participant.fullName, record.participant.college, record.participant.email,
          record.participant.phone, record.participant.year, record.participant.department,
          score.roundScores[1], score.roundScores[2], score.roundScores[3], score.total,
          record.answers.length ? Math.round(score.total / record.totalQuestions * 100) + "%" : "",
          record.status, record.startedAt, record.completedAt || "",
          record.rapidFinal?.eligible ? "Yes" : "No",
          record.rapidFinal?.status || "not_attempted",
          record.rapidFinal?.score ?? "",
          record.rapidFinal?.totalCorrectResponseMs ?? "",
          record.rapidFinal?.combinedScore ?? "",
          record.rapidFinal?.ranking ?? ""]);
      });
      downloadCsv("phishguard-results.csv", rows);
      setText("#adminCount", `Exported ${records.length} participant records`);
    } catch (error) { setText("#adminCount", "Export failed: " + error.message); }
  }
  function exportAnswers() {
    try {
      const rows = [["Participant ID", "Name", "Assessment", "Question", "Round", "Participant Answer", "Correct Answer", "Result", "Response Time ms", "Server Received", "Explanation"]];
      attempts().forEach(record => {
        const answers = new Map(record.answers.map(answer => [answer.questionId, answer]));
        record.questionIds.forEach((id, index) => {
          const question = QUESTIONS.find(item => item.id === id);
          if (!question) return;
          const answer = answers.get(id);
          const round = index < 15 ? "Round 1" : index < 30 ? "Round 2" : "Final Round";
          rows.push([record.id, record.participant.fullName, "Main Quiz", question.title, round,
            answer ? answer.choice : "No answer submitted",
            record.resultReview?.[index]?.correctAnswer || "—",
            record.resultReview?.[index] ? (record.resultReview[index].isCorrect ? "Correct" : "Incorrect") : "—",
            "", "", record.resultReview?.[index]?.explanation || ""]);
        });
        (record.rapidFinal?.answers || []).forEach((answer, index) => {
          rows.push([record.id, record.participant.fullName, "RAPID FINAL", answer.title, `Question ${index + 1}`,
            answer.choiceIndex == null ? "Timed out / unanswered" : answer.options[answer.choiceIndex],
            answer.correctAnswer == null ? "—" : answer.options[answer.correctAnswer],
            answer.choiceIndex == null ? "Unanswered" : answer.isCorrect ? "Correct" : "Incorrect",
            answer.responseTimeMs, new Date(answer.submittedAt).toISOString(), answer.explanation]);
        });
      });
      downloadCsv("phishguard-answer-review.csv", rows);
    } catch (error) { setText("#adminCount", "Export failed: " + error.message); }
  }

  $$("#adminSearch, #filterCollege, #filterDepartment, #filterYear, #filterStatus, #sortParticipants")
    .forEach(control => control.addEventListener("input", renderDashboard));
  $("#participantRows").addEventListener("click", event => {
    const button = event.target.closest("[data-participant]");
    if (button) renderParticipantDetail(button.dataset.participant);
  });
  $("#exportResults").addEventListener("click", exportResults);
  $("#exportAnswers").addEventListener("click", exportAnswers);
  $("#adminLogout").addEventListener("click", async () => {
    stopLiveMonitoring();
    $("#participantDetail").hidden = true;
    history.replaceState(null, "", location.pathname + location.search);
    try {
      await PGAuthService.logout();
      $("#liveParticipants").innerHTML = `<p class="empty">Admin access required to view monitoring.</p>`;
      $("#monitorFeed").innerHTML = `<li class="empty">Admin access required to view monitoring.</li>`;
      go("admin-login");
    } catch (error) {
      report("#adminError", "Could not end the admin session: " + error.message);
    }
  });

  window.addEventListener("pageshow", async event => {
    if (!event.persisted) return;
    try {
      await PGAuthService.restore();
      if (!PGAuthService.isAuthenticated() && $("#view-admin").classList.contains("active")) go("admin-login");
      else if (PGAuthService.isAuthenticated() && $("#view-admin").classList.contains("active")) startLiveMonitoring();
    } catch (error) {
      if ($("#view-admin").classList.contains("active")) go("admin-login");
      console.error("Admin session restore:", error);
    }
  });

  PGAuthService.restore().then(authenticated => {
    if (authenticated) {
      renderDashboard();
      go("admin");
      startLiveMonitoring();
    }
  }).catch(error => console.error("Admin session restore:", error));
  if (activeAttemptId()) resumeActiveAttempt();
  resumeRapidFinal();
})();
