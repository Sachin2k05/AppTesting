# Dependency & Supply-Chain Report

**Target** `voicehire-backend` · **Scanner** `npm audit` (npm 10) · **Date** 2026-08-17

---

## Tooling availability — stated plainly

| Scanner | This machine | In CI |
|---|---|---|
| `npm audit` | **available — used for this report** | yes |
| `semgrep` | not installed | yes, via the workflow |
| `trivy` | not installed | yes, via the workflow |
| `gitleaks` | not installed | yes, via the workflow |
| OWASP Dependency-Check | not installed | optional job in the workflow |

The three missing scanners were **not run**, so nothing in this report is attributed
to them. `.github/workflows/security-review.yml` installs and runs all of them on
push, pull request and manual dispatch.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Moderate | 1 |
| Low | 1 |

---

## Findings

### nodemailer `^6.9.7` — **High** — direct dependency

> Email to an unintended domain can occur due to Interpretation Conflict

**Reachability: HIGH.** This is the one advisory with a live attack path. The library
is invoked by `POST /api/applications/send-email`, which is **unauthenticated**
(finding `VH-003`) and whose rate limiter is bypassable (`VH-004`). A recipient string
parsed differently by the library than by application validation can deliver mail to
a domain the application did not intend.

**Fix.** `npm audit fix`, or upgrade nodemailer explicitly, **and** authenticate the
endpoint. Validate recipients server-side independently of the library's parser —
patching the library alone leaves the open relay.

---

### brace-expansion — **High** — transitive

> Denial of service via exponential-time expansion of consecutive non-expanding `{}` groups

**Reachability: LOW.** Pulled in through build and development tooling, not through
any request path in `src/`. No untrusted input reaches it at runtime.

**Fix.** `npm audit fix`. Low urgency, but it will be flagged by any dependency review
gate.

---

### uuid `^9.0.0` — **Moderate** — direct dependency

> Missing buffer bounds check in v3/v5/v6 when `buf` is provided

**Reachability: LOW.** The codebase generates identifiers without supplying a buffer,
which is the only path to the defect.

**Fix.** `npm audit fix`.

---

### One additional Low advisory — transitive

Reported by `npm audit` with no known request-path exposure. See the raw `npm audit`
output for detail.

---

## Supply-chain observations

**Dependency surface is small and deliberate.** Nine runtime dependencies, one dev
dependency. Every one has a clear purpose: `express`, `cors`, `dotenv`,
`@supabase/supabase-js`, `bcryptjs`, `jsonwebtoken`, `nodemailer`, `pdfkit`, `resend`,
`uuid`. There is no sprawling transitive tree of the kind that usually drives
supply-chain risk, and no unmaintained or typosquat-looking package.

**`bcryptjs` appears unused.** Authentication is delegated to Supabase and no password
hashing happens in this codebase. An unused crypto dependency is dead weight and a
future footgun — if someone later reaches for it, they will be hand-rolling password
storage that Supabase already does correctly. Recommend removing it, or documenting
why it is retained.

**Two mail paths.** Both `nodemailer` and `resend` are present. Maintaining two
delivery mechanisms doubles the surface for the misdelivery class of bug in `VH-005`.
Consolidating on one would reduce risk.

**Lockfile is committed**, so builds are reproducible.

---

## Recommended actions

1. `npm audit fix` — clears the moderate and low advisories and most of the high ones.
2. Upgrade `nodemailer` explicitly and verify the advisory clears.
3. **Authenticate `/api/applications/send-email`** — the dependency fix alone does not
   close the abuse path.
4. Remove `bcryptjs` if it is genuinely unused.
5. Enable the CI workflow so `npm audit`, Semgrep, Trivy and Gitleaks run on every
   push and pull request, failing the build only on Critical.

---

## Reproducing this report

```bash
cd voicehire-backend && npm audit --json > audit.json && npm audit
```
