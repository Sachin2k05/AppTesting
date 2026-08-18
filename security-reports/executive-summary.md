# Executive Summary

**Target** `voicehire-backend` — Node.js 18 / Express 4.18 / Supabase (PostgreSQL + RLS)
**Assessed** 2026-08-17 · SAST + read-only DAST + dependency audit

---

## Total Findings — 12

| Severity | Count |
|---|---|
| **Critical** | **1** |
| **High** | **4** |
| **Medium** | **5** |
| **Low** | **2** |

---

## Most Critical Risks

### 1. CORS reflects any origin while allowing credentials — `VH-001` · Critical

`server.js` approves **every** origin and sets `credentials: true`. Verified live: a
request claiming `Origin: https://evil.example.com` came back with
`Access-Control-Allow-Origin: https://evil.example.com` and
`Access-Control-Allow-Credentials: true`.

Any page a signed-in candidate visits can read their profile, knowledge graph,
conversation history and applications. This is the single highest-impact issue and
the cheapest to fix — an allow-list array.

### 2. Sixteen unauthenticated endpoints over one shared store — `VH-002` · High

Every route in `/api/tracker/*` and `/api/notifications/*` is missing
`authMiddleware` and operates on process-global `Map`s with no per-user key. Verified
live: six endpoints returned **200 with no token at all**. The write endpoints let an
anonymous caller delete or alter entries other users see.

### 3. Unauthenticated mail relay with bypassable throttling — `VH-003` + `VH-004` + `VH-005` · High

`POST /api/applications/send-email` sends to a caller-supplied address with no
authentication. Its 20/minute limiter reads a client-controlled `X-Forwarded-For`
before `req.ip`, and `trust proxy` is never enabled — so rotating that header defeats
it entirely. The installed `nodemailer` also carries a HIGH advisory for delivering
mail to unintended domains. Together: an open relay usable for phishing from the
project's own sender.

---

## Overall Security Score

# 18 / 100

**How this is calculated** — base 100, minus 20 per Critical, 10 per High, 4 per
Medium, 1 per Low. `100 − (1×20 + 4×10 + 5×4 + 2×1) = 18`.

**Read this number carefully.** It is a mechanical severity tally, and it understates
the codebase in one important respect: **the authentication core is genuinely well
built.** Identity is verified server-side against Supabase rather than trusted from
the client, forged tokens were rejected in every attempt (`alg=none`, forged HS256,
garbage, missing — all 401), the two-client RLS model correctly reserves the
service-role key for identity linking, there is no SQL injection surface, and no
secrets are committed. The prior credential-free `register`/`login` endpoints have
been properly closed with 410 Gone.

The score is low because of **perimeter and configuration** faults — CORS, missing
auth on two route families, a bypassable limiter — not because the security model is
unsound. Four changes, none architectural, move this most of the way up:

| Fix | Effort | Removes |
|---|---|---|
| CORS allow-list | ~5 lines | 20 pts (Critical) |
| `authMiddleware` on tracker + notifications | 2 files | 10 pts |
| `trust proxy` + drop raw XFF | ~3 lines | 10 pts |
| Auth on `send-email` + `npm audit fix` | small | 14 pts |

Applying those four yields roughly **72/100** with no redesign.

---

## Scope and honesty notes

- Dynamic testing ran against a **local** instance only. Production was never probed.
- All probes were **read-only**. No write, delete or email endpoint was invoked, so
  `VH-003` and `VH-006` are proven from code rather than demonstrated live — marked
  `CONFIRMED-CODE` rather than claimed as executed.
- `semgrep`, `trivy` and `gitleaks` are **not installed** on this machine. Dependency
  findings come from `npm audit`. The supplied GitHub Actions workflow runs all four
  in CI, where they are available.
- No credential value appears in any deliverable.
