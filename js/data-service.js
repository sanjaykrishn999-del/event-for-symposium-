/* Storage adapter kept separate from UI so a backend can replace this later. */
(function () {
  const KEY = "phishguard.symposium.attempts.v1";

  function readAttempts() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const attempts = JSON.parse(raw);
    if (!Array.isArray(attempts)) throw new Error("Stored participant data is invalid.");
    return attempts;
  }

  function saveAttempts(attempts) {
    localStorage.setItem(KEY, JSON.stringify(attempts));
  }

  window.PGDataService = Object.freeze({
    getAttempts: readAttempts,
    getAttempt(id) {
      return readAttempts().find(attempt => attempt.id === id) || null;
    },
    saveAttempt(attempt) {
      const attempts = readAttempts();
      const index = attempts.findIndex(item => item.id === attempt.id);
      if (index < 0) attempts.push(attempt);
      else attempts[index] = attempt;
      saveAttempts(attempts);
      return attempt;
    }
  });
})();
