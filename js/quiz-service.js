/* Fixed three-round quiz rules and private score calculation. */
(function () {
  const ROUND_SIZES = Object.freeze([10, 10, 5]);

  function questionsFor(attempt) {
    const byId = new Map(QUESTIONS.map(question => [question.id, question]));
    return attempt.questionIds.map(id => byId.get(id)).filter(Boolean);
  }

  function roundBounds(round) {
    const start = ROUND_SIZES.slice(0, round - 1).reduce((sum, size) => sum + size, 0);
    return { start, size: ROUND_SIZES[round - 1] };
  }

  window.PGQuizService = Object.freeze({
    roundSizes: ROUND_SIZES,
    selectQuestions() {
      const ids = QUESTIONS.map(question => question.id);
      for (let index = ids.length - 1; index > 0; index--) {
        const target = Math.floor(Math.random() * (index + 1));
        [ids[index], ids[target]] = [ids[target], ids[index]];
      }
      return ids.slice(0, 25);
    },
    questionAt(attempt) {
      const { start } = roundBounds(attempt.currentRound);
      return questionsFor(attempt)[start + attempt.currentQuestion] || null;
    },
    roundSize: round => ROUND_SIZES[round - 1],
    overallIndex(attempt) {
      return roundBounds(attempt.currentRound).start + attempt.currentQuestion;
    },
    saveAnswer(attempt, choice) {
      const question = this.questionAt(attempt);
      if (!question || !["legitimate", "phishing"].includes(choice)) {
        throw new Error("That answer could not be recorded.");
      }
      const answer = { questionId: question.id, round: attempt.currentRound, choice };
      const previous = attempt.answers.findIndex(item => item.questionId === question.id);
      if (previous < 0) attempt.answers.push(answer);
      else attempt.answers[previous] = answer;
      attempt.currentQuestion++;
      return window.PGParticipantService.save(attempt);
    },
    score(attempt) {
      const byId = new Map(QUESTIONS.map(question => [question.id, question]));
      const roundScores = { 1: 0, 2: 0, 3: 0 };
      for (const answer of attempt.answers) {
        if (byId.get(answer.questionId)?.answer === answer.choice) roundScores[answer.round]++;
      }
      return {
        roundScores,
        total: Object.values(roundScores).reduce((sum, score) => sum + score, 0)
      };
    }
  });
})();
