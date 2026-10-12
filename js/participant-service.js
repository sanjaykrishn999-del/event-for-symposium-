/* Participant attempts and their persistence lifecycle. */
(function () {
  const data = () => window.PGDataService;

  function create(details, questionIds) {
    const attempts = data().getAttempts();
    const year = new Date().getFullYear();
    const sequence = attempts.reduce((max, attempt) => {
      const match = new RegExp("^PG-" + year + "-(\\d+)$").exec(attempt.id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const attempt = {
      id: "PG-" + year + "-" + String(sequence).padStart(4, "0"),
      participant: details,
      startedAt: new Date().toISOString(),
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
    return data().saveAttempt(attempt);
  }

  function save(attempt) {
    const saved = data().saveAttempt(attempt);
    const serverVerified = attempt.status === "Completed" &&
      Number.isInteger(attempt.score) && Array.isArray(attempt.resultReview);
    if (window.PGMonitoringService && !serverVerified) window.PGMonitoringService.syncAttempt(attempt);
    return saved;
  }

  function reidentify(attempt, participantId, startedAt) {
    const previousId = attempt.id;
    attempt.id = participantId;
    attempt.startedAt = startedAt;
    if (previousId !== participantId) data().removeAttempt(previousId);
    return data().saveAttempt(attempt);
  }

  window.PGParticipantService = Object.freeze({
    create,
    get: id => data().getAttempt(id),
    save,
    reidentify,
    finish(attempt) {
      attempt.status = "Completed";
      attempt.completedAt = new Date().toISOString();
      attempt.score = null;
      attempt.accuracy = null;
      return save(attempt);
    }
  });
})();
