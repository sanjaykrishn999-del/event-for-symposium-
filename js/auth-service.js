/* Admin identity is held in an HTTP-only server session, never in browser storage. */
(function () {
  let authenticated = false;

  async function request(path, body) {
    if (location.protocol === "file:") {
      throw new Error("Admin login requires the PhishGuard server. Start it with npm start, then open http://localhost:8000.");
    }
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`The PhishGuard API returned a non-JSON response (HTTP ${response.status}). Start the server with npm start and open http://localhost:8000.`);
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Admin authentication request failed.");
    return result;
  }

  window.PGAuthService = Object.freeze({
    async login(adminId, password) {
      const result = await request("/api/admin/login", { adminId, password });
      authenticated = result.authenticated === true;
      return authenticated;
    },
    async restore() {
      try {
        const result = await request("/api/admin/session");
        authenticated = result.authenticated === true;
      } catch (error) {
        authenticated = false;
        throw error;
      }
      return authenticated;
    },
    isAuthenticated() {
      return authenticated;
    },
    async logout() {
      try {
        await request("/api/admin/logout", {});
      } finally {
        authenticated = false;
      }
    }
  });
})();
