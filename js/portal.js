/* Participant competition and organizer portal UI. */
(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const ACTIVE_KEY = "phishguard.active.attempt.v1";
  let attempt = null;
  let answerLocked = false;
  let stopMonitoringStream = null;
  let monitoringGeneration = 0;
  let monitoringParticipants = new Map();
  let monitoringEvents = [];
  let centralAttempts = new Map();

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"]/g, char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  }
  function setText(selector, value) { $(selector).textContent = value; }
  function report(selector, message) { setText(selector, message); }
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
    setText("#contestProgress", (PGQuizService.overallIndex(attempt) + 1) + " / 25");
    $("#contestBar").style.width = ((number - 1) / total * 100) + "%";
    $("#contestStage").innerHTML = `<p class="eyebrow">${esc(question.category.toUpperCase())} · ${esc(question.title)}</p>${renderScenario(question)}`;
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
      setText("#transitionDescription", "");
      setText("#startNextRound", "START ROUND 2 →");
    } else {
      setText("#transitionEyebrow", "ROUND 2 COMPLETED");
      setText("#transitionTitle", "Final Round");
      setText("#transitionDescription", "5 questions remain.");
      setText("#startNextRound", "START FINAL ROUND →");
    }
    go("round-transition");
  }

  function nextQuestion() {
    if (attempt.currentQuestion < PGQuizService.roundSize(attempt.currentRound)) {
      showCurrentQuestion();
    } else if (attempt.currentRound < 3) {
      openTransition(attempt.currentRound);
    } else {
      const result = PGQuizService.score(attempt);
      PGParticipantService.finish(attempt, result.total, result.roundScores);
      PGMonitoringService.finish(attempt);
      setText("#completedAttemptId", attempt.id);
      sessionStorage.removeItem(ACTIVE_KEY);
      attempt = null;
      go("completion");
    }
  }

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
        const accuracy = record.answers.length ? Math.round(score / 25 * 100) + "%" : "—";
        return `<tr>
          <td><button class="link-button" data-participant="${esc(record.id)}">${esc(record.id)}</button></td>
          <td>${esc(p.fullName)}</td><td>${esc(p.college)}</td>
          <td><a href="mailto:${encodeURIComponent(p.email)}">${esc(p.email)}</a></td>
          <td>${esc(p.phone)}</td><td>${esc(p.year)}</td><td>${esc(p.department)}</td>
          <td>${score}/25</td><td>${accuracy}</td><td><span class="status ${record.status === "Completed" ? "done" : "pending"}">${esc(record.status)}</span></td>
        </tr>`;
      }).join("") : `<tr><td colspan="10" class="empty">No participants match these filters.</td></tr>`;
      report("#adminError", "");
    } catch (error) {
      $("#participantRows").innerHTML = `<tr><td colspan="10" class="empty">Could not load participant data: ${esc(error.message)}</td></tr>`;
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
      const accuracy = record.answers.length ? Math.round(score / 25 * 100) + "%" : "—";
      const answers = new Map(record.answers.map(answer => [answer.questionId, answer]));
      const bounds = [0, 10, 20, 25];
      const answerRows = record.questionIds.map((questionId, index) => {
        const question = QUESTIONS.find(item => item.id === questionId);
        if (!question) return "";
        const saved = answers.get(questionId);
        const round = index < bounds[1] ? 1 : index < bounds[2] ? 2 : 3;
        const selected = saved ? saved.choice : "";
        return `<tr><td>Q${index + 1}</td><td>Round ${round === 3 ? "Final" : round}</td>
          <td>${selected ? esc(selected) : "No answer submitted"}</td>
          <td>${esc(question.answer)}</td>
          <td>${selected ? (selected === question.answer ? "Correct" : "Incorrect") : "—"}</td></tr>`;
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
          <p><b>Status</b><span>${esc(record.status)}</span></p><p><b>Total questions</b><span>25</span></p>
          <p><b>Final score</b><span>${score} / 25</span></p><p><b>Accuracy</b><span>${accuracy}</span></p>
        </div>
        <h3>Round performance</h3>
        <div class="grid g3 round-scores">
          <div class="tile"><b>${scores[1]} / 10</b><span>Round 1</span></div>
          <div class="tile"><b>${scores[2]} / 10</b><span>Round 2</span></div>
          <div class="tile"><b>${scores[3]} / 5</b><span>Final round</span></div>
        </div>
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
        "Start Time", "Completion Time"]];
      records.forEach(record => {
        const score = PGQuizService.score(record);
        rows.push([record.id, record.participant.fullName, record.participant.college, record.participant.email,
          record.participant.phone, record.participant.year, record.participant.department,
          score.roundScores[1], score.roundScores[2], score.roundScores[3], score.total,
          record.answers.length ? Math.round(score.total / 25 * 100) + "%" : "",
          record.status, record.startedAt, record.completedAt || ""]);
      });
      downloadCsv("phishguard-results.csv", rows);
      setText("#adminCount", `Exported ${records.length} participant records`);
    } catch (error) { setText("#adminCount", "Export failed: " + error.message); }
  }
  function exportAnswers() {
    try {
      const rows = [["Participant ID", "Name", "Question", "Round", "Participant Answer", "Correct Answer", "Result"]];
      attempts().forEach(record => {
        const answers = new Map(record.answers.map(answer => [answer.questionId, answer]));
        record.questionIds.forEach((id, index) => {
          const question = QUESTIONS.find(item => item.id === id);
          if (!question) return;
          const answer = answers.get(id);
          const round = index < 10 ? "Round 1" : index < 20 ? "Round 2" : "Final Round";
          rows.push([record.id, record.participant.fullName, question.title, round,
            answer ? answer.choice : "No answer submitted", question.answer,
            answer ? (answer.choice === question.answer ? "Correct" : "Incorrect") : "—"]);
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
})();
