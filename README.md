# PhishGuard — Can You Spot the Phish?

**Think before you click.**

An educational phishing-awareness simulator built for a college cybersecurity
symposium. Participants inspect realistic (but entirely fictional) emails, text
messages, login pages and QR scenarios and decide whether each one is
**legitimate** or **phishing**. The symposium quiz uses a three-round format:
10 questions, 10 questions, then 5 questions.

---

## Running it

The quiz and monitoring API run on Node.js 22 LTS. This runtime is pinned
because the native `better-sqlite3` addon does not build against Node.js 26.
Install dependencies
once with `npm install`, then configure the server-only admin ID, salted
scrypt password hash, and session signing secret in a local, Git-ignored `.env`
file before starting the application.

PowerShell:

    $env:PHISHGUARD_ADMIN_ID = "organizer"
    $env:PHISHGUARD_ADMIN_PASSWORD_HASH = "scrypt$<32-hex-salt>$<128-hex-key>"
    $secretBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($secretBytes)
    $env:PHISHGUARD_SESSION_SECRET = [Convert]::ToBase64String($secretBytes)
    $rng.Dispose()
    npm install
    npm start

Open `http://localhost:8000`. Monitoring data and server sessions are stored in
`data/phishguard.sqlite`. Set `PORT` to change the listener. For deployment,
use HTTPS, persistent disk for SQLite, a strong private session secret, and a
trusted reverse proxy only when setting `TRUST_PROXY=1`. Do not expose the admin password, password hash, or session secret to browser
code or commit them. The password hash uses a random 16-byte salt and a 64-byte
`crypto.scryptSync` key; keep the hash in `.env` and do not put the password
itself in the configuration file.
The server binds to `127.0.0.1` by default. For testing on a trusted LAN,
set `HOST=0.0.0.0` and open the computer's LAN address from the mobile device;
do not expose an unencrypted deployment to an untrusted network.

The static `python -m http.server` workflow is not suitable for quiz monitoring:
it has no authenticated API or server-side database.
Run the API and security tests with `npm test` after dependencies are installed.
The admin monitor uses one authenticated Server-Sent Events connection; its
initial snapshot and reconnect snapshots are read from the centralized database,
and later database changes are sent as participant-specific updates. The browser
reconnects the stream automatically. Participant monitoring retries transient
network failures with backoff and deduplicates retried session/event writes.
The participant quiz displays a warning if its monitoring session cannot reach
the backend. Routine progress heartbeats update participant presence without
creating audit-event rows or broadcasting unchanged snapshots. The complete
attempt (participant details, answers, progress, and scores) is
stored in that same SQLite database. The participant browser keeps a local
resume cache, but the admin dashboard, participant details, and exports read
only from the server's authenticated initial snapshot and incremental SSE
updates. Attempts are upserted when created or changed; the admin does not
poll or reload the full list after each change. The service worker checks the
network for current app code and falls back to its cache when offline; it does
not cache API requests or make offline attempts appear in the central admin
portal.

### Deploying on Render

The quiz monitoring and admin login require the Node.js API. A Render Static
Site can serve the webpage but cannot run this API; requests to `/api/*` will
fail. Create a Render **Blueprint** for this repository using `render.yaml`,
or create a **Web Service** with build command `npm ci` and start command
`npm start`. Do not deploy it as a Static Site.

Set these private environment variables in the Web Service:

- `PHISHGUARD_ADMIN_ID`
- `PHISHGUARD_ADMIN_PASSWORD_HASH` (the salted scrypt hash, not the plaintext password)
- `PHISHGUARD_SESSION_SECRET` (at least 32 random characters)

The service uses Node.js 22 LTS, binds to `0.0.0.0` in production, and trusts
Render's single HTTPS proxy hop so same-origin login checks and secure session
cookies work behind TLS termination. `render.yaml` mounts a persistent disk at
`/opt/render/project/src/data`; this is required because SQLite and the SSE
publisher are local to the API process. Render disks pin the service to one
instance so every device writes to the same database and reaches the same live
event publisher. The disk requires a Render plan that supports persistent
disks. Use the exact **Web Service** HTTPS URL on every PC, laptop, and mobile
device; `localhost` always refers to the device itself. Do not use the old
Static Site URL or a separately hosted copy of the frontend.
After deployment, verify `<web-service-url>/api/health` returns JSON with
`"status":"ok"`. The admin and participant pages must share the same HTTPS
origin; a 404 from `/api/health` means the URL is not serving this backend.

The opening screen plays an original, lightweight canvas web-swing sequence
behind a rotating cybersecurity calibration HUD. Its responsive city framing,
web shots, progress milestones, and web-to-network transition lead into the
participant and admin entry. The artwork is a custom 2D canvas interpretation,
not a photorealistic 3D render; it uses no external assets or libraries. The
intro can be skipped and respects reduced-motion preferences.

Choose **ENTER SYMPOSIUM** to enter participant details and start the 25-question
competition. Participant details and answers are sent to the shared server
without correct/incorrect feedback or scores being shown to the participant.
The admin portal shows records from the centralized database, not the admin
browser's local storage. Choose
**ADMIN LOGIN** to review attempts, question-wise answers, and export CSV files.
The admin portal also displays server-recorded tab visibility, focus, fullscreen,
question progress, and return events for active quizzes. Activity is telemetry
only: leaving the tab never fails an attempt or changes an answer. Browser
events are client-reported signals and do not reveal what a participant did in
another tab; they are not tamper-proof proof of misconduct.

### Optional: serving it over http

The service worker in `sw.js` adds installable-PWA behaviour, but browsers only
register service workers over `http://` or `https://`. The monitoring API
bypasses the offline cache; the server must be running to create and review
monitoring records.

---

## Files

    index.html              User and admin screens, plus the learning sections
    css/styles.css          Design tokens, layout, mockup chrome, animations
    js/data.js              All content: scenarios, hunts, comparisons, lessons
    js/app.js               Existing learning activities and shared screen router
    server.js               Admin-authenticated monitoring API and SQLite store
    js/monitoring-service.js Browser lifecycle events and admin SSE client
    js/data-service.js      Participant-device resume cache
    js/auth-service.js      Server-backed admin session handling
    js/participant-service.js Participant IDs and attempt persistence
    js/quiz-service.js      Three-round selection and internal scoring
    js/cinematic-intro.js   Lightweight animated opening and access screen
    js/portal.js            Registration, competition flow, admin dashboard
    sw.js                   Offline cache for static assets (http only)
    manifest.webmanifest    PWA metadata
    assets/icon.svg         App icon

---

## What's inside

**Symposium quiz** — 25 randomized scenarios selected from 30 scenarios across
five categories (email, smishing, fake websites, quishing, AI phishing). The
three rounds contain exactly 10, 10, and 5 questions. Scores and answers are
only displayed in the admin portal.

**🔎 Find the red flags** — a full message is shown and the participant clicks
every suspicious part. Clicking a real clue marks it and names it; clicking
something harmless explains why it's normal.

**Site comparison** — two login pages side by side, with a breakdown of what
separates them afterwards.

**Learn / Red Flags / Checklist** — Phishing 101, ten warning signs, and a
before-you-click checklist.

**Leaderboard** — nicknames and scores in `localStorage`, on that device only.

---

## Adding or editing scenarios

Everything lives in `js/data.js`. A scenario looks like this:

```js
{
  id:"e1",                    // unique
  category:"email",           // email | sms | website | qr | ai
  difficulty:"easy",          // easy | medium | hard
  type:"email",               // email | sms | website | qr  (controls the mockup)
  title:"Bank security alert",
  sender:{ name:"...", email:"...", initials:"AB", color:"#1b3a6b" },
  subject:"...", date:"Today, 03:14",
  body:`<p>HTML for the message body</p>`,
  answer:"phishing",          // phishing | legitimate
  flags:["Clue one", "Clue two"],   // empty array for legitimate scenarios
  explanation:"Why it is what it is.",
  tip:"The habit to take away."
}
```

`type` decides which mockup renders it:

| type      | fields used                                        |
|-----------|----------------------------------------------------|
| `email`   | `sender`, `subject`, `date`, `body`                |
| `sms`     | `from`, `messages[]`, `stamp`                      |
| `website` | `url`, `secure`, `site{brand,color,heading,note,popup,fields[]}` |
| `qr`      | `poster{badge,heading,sub,foot}`, `scanned`        |

Red-flag hunts are in `HUNTS`: clickable clues are `<span class="hot"
data-name="short label" data-note="why it matters">`, and `total` must match the
number of `.hot` spans. Comparison pairs are in `COMPARES`.

---

## Safety notes

This is a simulator. It never becomes the thing it teaches about.

- The participant quiz never requests real account credentials, passwords,
  OTPs, card or bank details. Login fields in scenarios are `<span>` elements,
  not `<input>` elements. The admin form accepts only the configurable demo
  admin password.
- Links and buttons inside scenarios are disabled and lead nowhere.
- Every brand, domain, person, amount and reference number is invented.
  Resemblance to a real organisation is unintentional.
- Participant details, attempts, and monitoring sessions are stored in the
  server-side SQLite database. On Render, keep the persistent disk mounted and
  the Web Service on a single instance; participant browsers must use the same
  deployed HTTPS origin for the frontend and API. The browser's local attempt
  cache is for resuming an in-progress quiz only, not the admin data source.
- Admin identity is checked on the server using `PHISHGUARD_ADMIN_ID` and the
  salted scrypt hash in `PHISHGUARD_ADMIN_PASSWORD_HASH`; browser storage and
  source files do not contain admin credentials. Admin sessions use server-side
  SQLite storage and HTTP-only, same-site cookies. Restrict access to the
  server and use HTTPS.
- Monitoring events are stored separately from participant answer records.
  The server assigns event timestamps and appends activity; a participant can
  report browser lifecycle events only for their own server-issued session.
  The browser cannot reliably report hidden-tab activity if the device loses
  connectivity or is forcibly terminated.
- Participant answers and attempt details are written to the authenticated
  participant session's server-side record and delivered to admins through
  authenticated SSE. The local browser copy is a resume cache, not the system
  of record.
- Existing learning, red-flag hunt, website comparison, and nickname leaderboard
  features remain available.

## Accessibility

Keyboard navigable throughout with visible focus rings; feedback regions are
`aria-live`; correct and incorrect are marked with text and icons rather than
colour alone; `prefers-reduced-motion` disables the animations.

During the quiz: **1** or **L** for legitimate, **2** or **P** for phishing,
**Enter** for the next question — useful when driving a projector from a laptop.

## Credits

Built as a college symposium educational project. Content written for training
purposes; no external assets, fonts or libraries are used.
