# VoiceHire Backend — Security Review

**Target** `voicehire-backend` · Node.js 18 / Express 4.18 / Supabase (PostgreSQL + RLS)
**Assessment date** 2026-08-17
**Methodology** SAST (manual code review of all 5,317 lines across 21 modules), DAST
(read-only probing of a locally started instance), dependency audit (`npm audit`).

> **Rules of engagement.** All dynamic testing was performed against a **local**
> instance, never the production deployment, and was strictly read-only — no write,
> delete, or email-sending endpoint was invoked. No credential value appears anywhere
> in this report.

---

## Verification legend

| Tag | Meaning |
|---|---|
| `CONFIRMED-LIVE` | Reproduced against a running instance |
| `CONFIRMED-CODE` | Proven by reading the code; not exercised live to avoid side effects |
| `CONFIRMED-SCAN` | Reported by `npm audit` |
| `REVIEW-ONLY` | Weakness or risk observation, not a demonstrated exploit |

---

## VH-001 · CORS reflects any origin with credentials enabled

**Severity** Critical · **Type** Security Misconfiguration · `CONFIRMED-LIVE`
**File** `voicehire-backend/server.js:15-21` · **Endpoint** all

```js
app.use(cors({
  origin: function(origin, callback) {
    // Allow all origins in production
    callback(null, true)
  },
  credentials: true
}))
```

**Description.** The origin callback approves every origin, and `credentials: true`
is set. The server therefore reflects whatever `Origin` the caller sends and tells
the browser credentials may accompany cross-origin requests. The in-code comment
("Tighten to exact frontend URL once deployed") shows this was known and never done.

**Proof.** Against a running instance:

```
Request:  Origin: https://evil.example.com
Response: Access-Control-Allow-Origin: https://evil.example.com
          Access-Control-Allow-Credentials: true
```

**Exploitation.** An attacker hosts a page. A signed-in candidate visits it. Script
on that page issues cross-origin requests to the API; the browser permits reading the
responses because the server reflects the attacker's origin. Anything the victim's
browser can authenticate, the attacker's page can read.

**Impact.** Cross-origin disclosure of profile, knowledge graph, conversation history
and applications — the entire authenticated surface.

**Fix.** Replace the callback with an explicit allow-list:

```js
const ALLOWED = ['https://voicehire.app', 'http://localhost:8080']
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED.includes(origin)),
  credentials: true
}))
```

Never combine a reflected origin with `credentials: true`.

---

## VH-002 · Sixteen unauthenticated endpoints over shared mutable state

**Severity** High · **Type** Broken Access Control (OWASP A01) · `CONFIRMED-LIVE`
**Files** `src/routes/tracker.js`, `src/routes/notifications.js`
**Endpoints** all of `/api/tracker/*` (8) and `/api/notifications/*` (8)

**Description.** Neither router applies `authMiddleware`. Both read and write
module-level `new Map()` stores — `savedJobsStore`, `remindersStore`, `notifStore` —
that are shared by every caller of the process, with no per-user key.

**Proof.** With no `Authorization` header at all:

```
GET /api/tracker/dashboard     -> 200   {"appliedCount":2,"upcomingInterview":{...}}
GET /api/tracker/saved         -> 200
GET /api/tracker/analytics     -> 200
GET /api/notifications         -> 200
GET /api/notifications/unread  -> 200
GET /api/matching/recommendations -> 200
```

**Exploitation.** Read is trivial, as above. Writes are worse: `POST /reminder`,
`POST /read`, `POST /snooze`, `DELETE /notifications/:id` and
`DELETE /tracker/saved/:id` all mutate the shared store with no credential, so any
anonymous caller can delete or alter entries other users see.

**Impact.** Cross-tenant read and write with no authentication.

**Fix.** Apply `authMiddleware` to every route in both files, and key the data by
`req.userId` — or better, move it to RLS-protected Supabase tables accessed through
`req.supabase`, matching how `/api/graph` and `/api/profile` already work.

---

## VH-003 · Unauthenticated mail relay

**Severity** High · **Type** Abuse of Functionality · `CONFIRMED-CODE`
**File** `src/routes/applications.js:277` · **Endpoint** `POST /api/applications/send-email`

**Description.** The endpoint sends email to a recipient taken straight from
`req.body.to`, with no authentication. The only control is a 20/minute limiter, and
that limiter is bypassable (VH-004).

> Not exercised live: sending mail is a side effect outside the read-only scope.

**Exploitation.** POST arbitrary recipients with attacker-chosen `jobTitle` and
`company` strings, rotating `X-Forwarded-For` to defeat throttling, and deliver mail
from the project's verified sender.

**Impact.** Spam and phishing from the organisation's domain; sender-reputation
damage and possible blocklisting; provider cost abuse.

**Fix.** Require `authMiddleware`, and derive the recipient from the authenticated
user's own application record rather than the request body.

---

## VH-004 · Rate limiting bypassable via X-Forwarded-For

**Severity** High · **Type** Improper Restriction · `CONFIRMED-CODE`
**File** `src/middleware/rateLimit.js:26-30`

```js
const fwd = req.headers['x-forwarded-for']
const ip = (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.ip || ...
```

**Description.** The raw header is read **before** `req.ip`, and Express
`trust proxy` is never enabled (confirmed absent from `server.js`). The header is
therefore fully client-controlled and unvalidated.

**Exploitation.** Send a different `X-Forwarded-For` on each request. Every request
gets a fresh bucket and the limiter never fires.

**Impact.** Throttling is ineffective for unauthenticated callers, which directly
enables VH-003 and VH-006.

**Fix.**

```js
app.set('trust proxy', 1)   // Render terminates TLS at a proxy
// then in rateLimit.js use req.ip only — let Express parse the chain
```

Authenticated callers are already keyed by `u:<userId>` and are unaffected.

---

## VH-005 · nodemailer — mail sent to unintended domain

**Severity** High · **Type** Vulnerable Dependency · `CONFIRMED-SCAN`
**File** `package.json` (`nodemailer ^6.9.7`)

**Description.** `npm audit` reports a HIGH advisory: *"Email to an unintended domain
can occur due to Interpretation Conflict"*. The project exposes this library through
an **unauthenticated** endpoint (VH-003), so the two compound.

**Impact.** A recipient string parsed differently by the library than by application
validation can deliver mail to an unintended domain.

**Fix.** `npm audit fix`, upgrade to the patched release, and validate recipients
server-side independently of the library's parser.

---

## VH-006 · Unauthenticated CPU-bound PDF generation

**Severity** Medium · **Type** Resource Exhaustion · `CONFIRMED-CODE`
**File** `src/routes/applications.js:371` · **Endpoint** `POST /api/applications/generate-resume`

**Description.** PDFKit rendering runs for any anonymous caller with a caller-supplied
profile object, bounded only by the 1 MB body limit and the bypassable limiter.

**Impact.** CPU exhaustion. On Render's free tier this alone can make the service
unresponsive for real users.

**Fix.** Require authentication, cap this route's body well below 1 MB, and fix
VH-004.

---

## VH-007 · Missing HSTS, CSP and Permissions-Policy

**Severity** Medium · **Type** Security Misconfiguration · `CONFIRMED-LIVE`
**File** `server.js:31-34`

**Present** (verified live): `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`X-Permitted-Cross-Domain-Policies: none`.

**Absent**: `Strict-Transport-Security`, `Content-Security-Policy`,
`Permissions-Policy`.

**Impact.** No HSTS means a first plain-HTTP request can be downgraded. No
Permissions-Policy means microphone access is unconstrained for any embedded content.

**Fix.** Adopt `helmet` instead of hand-rolled headers; enable HSTS
(`max-age=31536000; includeSubDomains`) and `Permissions-Policy: microphone=(self)`.

---

## VH-008 · Shared in-memory state seeded with fabricated data

**Severity** Medium · **Type** Insecure Design · `CONFIRMED-LIVE`
**Files** `src/routes/tracker.js:5-9`, `src/routes/notifications.js:21-34`

**Description.** State lives in process memory, so it is neither durable nor shared
across the multiple instances Render may run. It is also **seeded with hardcoded demo
values** — `appliedCount: 2`, `"ABC Technologies"`, a fake meeting link — returned to
callers as though real.

**Impact.** For an application whose core promise is telling a blind candidate
truthfully whether an application was submitted, presenting invented counts as their
record is a serious integrity failure.

**Fix.** Move to RLS-protected tables scoped by `user_id`; delete the demo rows.

---

## VH-009 · brace-expansion (High) and uuid (Moderate) advisories

**Severity** Medium · **Type** Vulnerable Dependency · `CONFIRMED-SCAN`

`brace-expansion` — DoS via exponential-time expansion. Reachable only through
build/dev tooling here, not a request path. `uuid` — missing buffer bounds check in
v3/v5/v6 when a buffer is supplied; the code does not pass one.

**Fix.** `npm audit fix`; enforce the audit in CI.

---

## VH-010 · Legacy auth path disables RLS when enabled

**Severity** Medium · **Type** Authentication Design · `REVIEW-ONLY`
**File** `src/middleware/auth.js`

When `ALLOW_LEGACY_AUTH=true`, a self-issued HS256 JWT is accepted and `req.supabase`
becomes the **service-role** client, bypassing RLS for the entire request. The default
is `false` and the code logs loudly when used, which is good. The residual risk is
configuration drift plus a weak or leaked `JWT_SECRET`.

**Fix.** Assert the flag is false at boot in production; plan removal now that clients
use Supabase sign-in.

---

## VH-011 · Request field names logged outside production

**Severity** Low · **Type** Information Disclosure · `REVIEW-ONLY`
**File** `server.js:109`

When `NODE_ENV !== 'production'` the handler logs a **redacted** shape of the body.
Values are not printed. `render.yaml` sets `NODE_ENV=production`, so this does not
apply to the deployment. Acceptable as designed.

---

## VH-012 · No audit trail

**Severity** Low · **Type** Insufficient Logging · `REVIEW-ONLY`

No request id and no audit log of sign-in, account linking, application submission or
deletion. After an incident there is no reliable way to reconstruct events.

**Fix.** Add request-id middleware and structured audit logging of security events,
excluding payload values.

---

## Controls verified as working

These were tested and **passed**. They are recorded because a review that lists only
failures misrepresents the system.

| Control | Evidence |
|---|---|
| Server-verified identity | Bearer tokens verified via `serviceClient.auth.getUser()`; identity from the verified `sub`, never client-asserted |
| JWT forgery rejected | `alg=none` → **401**; forged HS256 → **401**; garbage token → **401**; missing token → **401** |
| Two-client RLS model | Service-role client reserved for identity linking; handlers use an RLS-scoped client bound to the caller's token |
| No SQL injection surface | All DB access via the Supabase client (parameterised). No concatenated SQL found |
| No hardcoded secrets | No credential-shaped literals in source; `.env` is gitignored, only `.env.example` tracked |
| Errors do not leak internals | Generic 500; logs record failure shape with values redacted |
| Credential-free auth closed | `/api/auth/register` and `/login` return **410 Gone** unless explicitly re-enabled |
| Body size limited | `express.json` and `urlencoded` capped at 1 MB |

---

## Remediation order

1. **VH-001** — one-line CORS allow-list. Highest impact per effort.
2. **VH-002** — add `authMiddleware` to `tracker.js` and `notifications.js`.
3. **VH-003 + VH-004** — authenticate `send-email`; set `trust proxy` and drop the raw header.
4. **VH-005 / VH-009** — `npm audit fix`.
5. **VH-006 / VH-007 / VH-008** — auth the resume route, adopt `helmet`, migrate the in-memory stores.
