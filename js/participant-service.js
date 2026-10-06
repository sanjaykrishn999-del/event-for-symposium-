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
      totalQuestions: 25,
      roundScores: { 1: 0, 2: 0, 3: 0 },
      score: null,
      accuracy: null
    };
    return data().saveAttempt(attempt);
  }

  window.PGParticipantService = Object.freeze({
    create,
    get: id => data().getAttempt(id),
    save: attempt => data().saveAttempt(attempt),
    finish(attempt, score, roundScores) {
      attempt.status = "Completed";
      attempt.completedAt = new Date().toISOString();
      attempt.score = score;
      attempt.accuracy = Math.round(score / attempt.totalQuestions * 100);
      attempt.roundScores = roundScores;
      return data().saveAttempt(attempt);
    }
  });
})();
