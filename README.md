# PhishGuard — Can You Spot the Phish?

**Think before you click.**

An educational phishing-awareness simulator built for a college cybersecurity
symposium. Participants inspect realistic (but entirely fictional) emails, text
messages, login pages and QR scenarios and decide whether each one is
**legitimate** or **phishing**. The symposium quiz uses a three-round format:
10 questions, 10 questions, then 5 questions.

---

## Running it

No build step, no install, no internet connection.

    Open index.html in any modern browser.

For a reliable localStorage experience, serve the folder over localhost.

The opening screen plays an original, lightweight animated web-swing sequence
with an abstract masked silhouette, three web shots, and a web-to-network
transition before the separate participant and admin entry. The canvas artwork
is deliberately stylized rather than photorealistic. The intro can be skipped
and respects reduced-motion preferences.

Choose **ENTER SYMPOSIUM** to enter participant details and start the 25-question
competition. Answers and participant details are saved locally without
correct/incorrect feedback or scores being shown to the participant. Choose
**ADMIN LOGIN** to review attempts, question-wise answers, and export CSV files.

### Optional: serving it over http

The service worker in `sw.js` adds installable-PWA behaviour, but browsers only
register service workers over `http://` or `https://`. From a folder:

    python3 -m http.server 8000     # then open http://localhost:8000

Opening `index.html` directly still works offline — the registration is skipped
automatically and nothing breaks.

---

## Files

    index.html              User and admin screens, plus the learning sections
    css/styles.css          Design tokens, layout, mockup chrome, animations
    js/data.js              All content: scenarios, hunts, comparisons, lessons
    js/app.js               Existing learning activities and shared screen router
    js/admin-config.js      Demo-only admin ID and password configuration
    js/data-service.js      Local storage adapter for participant attempts
    js/auth-service.js      Demo admin session handling
    js/participant-service.js Participant IDs and attempt persistence
    js/quiz-service.js      Three-round selection and internal scoring
    js/cinematic-intro.js   Lightweight animated opening and access screen
    js/portal.js            Registration, competition flow, admin dashboard
    sw.js                   Optional offline cache (http only)
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
- Participant details, attempts, and the admin session are held in browser
  storage for this local demonstration. Do not use real sensitive data in a
  production deployment.
- `js/admin-config.js` ships with empty values. Set local demonstration
  credentials there before using the admin login, and do not commit real
  credentials. Client-side credentials and localStorage are not secure: deploy
  backend authentication and a database before using real participant data.
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
