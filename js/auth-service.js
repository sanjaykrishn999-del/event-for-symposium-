/* Demo-only local authentication. Use a server-side identity provider in production. */
(function () {
  const SESSION_KEY = "phishguard.admin.session.v1";

  window.PGAuthService = Object.freeze({
    login(adminId, password) {
      const config = window.adminConfig;
      if (!config || adminId !== config.adminId || password !== config.password) return false;
      sessionStorage.setItem(SESSION_KEY, "authenticated");
      return true;
    },
    isAuthenticated() {
      return sessionStorage.getItem(SESSION_KEY) === "authenticated";
    },
    logout() {
      sessionStorage.removeItem(SESSION_KEY);
    }
  });
})();
