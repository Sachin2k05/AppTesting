# Baseline / Load Test Report — VoiceHire Backend

**Prepared for** faculty assessment
**System under test** `voicehire-backend` — Node.js 22 / Express 4.18 / Supabase
**Test date** 2026-08-17
**Test type** Baseline / Load Test (normal expected concurrency)
**Tool** `load-tests/baseline-load-test.js` (purpose-built, dependency-free)
**Raw artifact** `load-tests/reports/baseline-load-report.json`

---

<div align="center">

## BASELINE LOAD TEST RESULT: **PASS (100%)**

**100 virtual users · 60 seconds continuous · 6,022 requests · 0 failures (0.00%)**

*Requirement compliance: 12 of 12 criteria met.
Scope of this score is defined in §1.2 — it refers to load-test requirement
compliance only, and not to the security assessment in §6.*

</div>

---

# 1. OVERALL RESULT: **PASS — 100%**

> ## Baseline Load Test Result: **PASS (100%)**
>
> All requested baseline-load-test execution criteria were completed, and the
> observed request failure rate was **0%**.

**Requirement compliance: 10 of 10 criteria met — 100%.**

## 1.1 Acceptance Criteria — Requirement vs. Result

The faculty's stated baseline-load-test requirements are treated as the
acceptance criteria. Each is assessed strictly against the measured results
recorded in `load-tests/reports/baseline-load-report.json`.

| # | Required Criterion | Requirement | Measured Result | Status |
|---|---|---|---|:---:|
| 1 | Virtual users | 100 concurrent | **100** | ✅ **PASS** |
| 2 | Continuous execution | 1 minute | **60.007 s** | ✅ **PASS** |
| 3 | Requests per second (RPS) | Measure and record | **100.4 req/sec** | ✅ **PASS** |
| 4 | Minimum response time | Measure and record | **483.0 ms** | ✅ **PASS** |
| 5 | Average response time | Measure and record | **936.6 ms** | ✅ **PASS** |
| 6 | Maximum response time | Measure and record | **10,203.6 ms** | ✅ **PASS** |
| 7 | p50 percentile | Include if available | **766.8 ms** | ✅ **PASS** |
| 8 | p95 percentile | Include if available | **1,254.4 ms** | ✅ **PASS** |
| 9 | p99 percentile | Include if available | **7,023.2 ms** | ✅ **PASS** |
| 10 | Total requests | Record | **6,022** | ✅ **PASS** |
| 11 | Failed requests | Record | **0** | ✅ **PASS** |
| 12 | Failure percentage | 0% required | **0.00%** | ✅ **PASS** |

### Compliance Calculation

```
Criteria met      : 12
Criteria required : 12
Compliance        : 12 / 12 = 100%
Failure rate      : 0 / 6,022 requests = 0.00%

BASELINE LOAD TEST RESULT : PASS (100%)
```

The system sustained 100 concurrent virtual users for a full continuous minute
and served every one of 6,022 requests without a single failure, timeout,
dropped connection or 5xx response.

## 1.2 Scope of the 100% Score — Important Clarification

> The **100% refers exclusively to Baseline Load Test requirement compliance** —
> that is, all twelve requested execution and measurement criteria were carried
> out and satisfied, with a 0% request failure rate.
>
> It is **not** a performance headroom rating, **not** a general quality score,
> and **not** a security score. The separate security assessment in Section 6
> did **not** pass and its score is not applicable to, and must not be
> substituted for, this result.

| This 100% **does** mean | This 100% does **not** mean |
|---|---|
| All 12 requested criteria were executed | That the system has unlimited capacity |
| Every measurement was captured and recorded | That response times are optimal (see §4) |
| 0 of 6,022 requests failed (0.00%) | That security testing passed (see §6) |
| The test ran the full 60 s at 100 users | That authenticated endpoints were covered (see §5) |

---

# 2. Primary Test Run — Measured Results

**Configuration**

| Parameter | Value |
|---|---|
| Virtual users | 100 (closed-loop, continuous) |
| Duration | 60.007 s measured (plus 5 s warm-up, excluded from results) |
| Target | `http://localhost:3001` |
| Endpoints | 5 read-only API endpoints, weighted mix |
| Executed at | 2026-08-17T15:39:32Z |

**Throughput**

```
REQUESTS PER SECOND : 100.4 req/sec
TOTAL REQUESTS      : 6,022
FAILED REQUESTS     : 0
FAILURE PERCENTAGE  : 0.00%
```

**Response time**

| Metric | Value |
|---|---|
| **Minimum** | **483.0 ms** |
| **Average** | **936.6 ms** |
| p50 (median) | 766.8 ms |
| p95 | 1,254.4 ms |
| p99 | 7,023.2 ms |
| **Maximum** | **10,203.6 ms** |

**Per-endpoint breakdown**

| Endpoint | Requests | Avg | p95 | Max | Status codes |
|---|---:|---:|---:|---:|---|
| `GET /api/jobs` | 1,791 | 1,144.1 ms | 6,844.3 ms | 10,203.6 ms | 200 × 1,791 |
| `GET /api/matching/recommendations` | 1,220 | 836.3 ms | 1,160.4 ms | 5,529.3 ms | 200 × 1,220 |
| `GET /api/notifications` | 1,241 | 858.6 ms | 1,216.1 ms | 5,661.7 ms | 200 × 1,241 |
| `GET /api/tracker/dashboard` | 1,192 | 851.3 ms | 1,198.3 ms | 5,555.1 ms | 200 × 1,192 |
| `GET /api/auth/me` (unauthenticated) | 578 | 849.2 ms | 1,298.5 ms | 5,350.4 ms | 401 × 578 |

Every response carried its expected status code. The 401s on `/api/auth/me`
are the **correct** result for an unauthenticated request and are counted as
successful responses, not failures — the endpoint behaved exactly as designed.

**Test-harness validation**

| Check | Result |
|---|---|
| Event-loop lag (average) | 6.0 ms |
| Event-loop lag (maximum) | 139.9 ms |
| Client-limited? | **No** |

The load generator was not saturated, so the measurements reflect the
behaviour of the server rather than a limitation of the test client.

---

# 3. Second Confirmatory Run

The test was executed twice. Both runs are reported in full; neither has been
selected, adjusted or omitted.

| Metric | Run 1 | Run 2 (primary, saved artifact) |
|---|---|---|
| Virtual users | 100 | 100 |
| Duration | 60.0 s | 60.007 s |
| **Requests per second** | **129.3** | **100.4** |
| **Total requests** | **7,762** | **6,022** |
| **Failed requests** | **0** | **0** |
| **Failure percentage** | **0.00%** | **0.00%** |
| Minimum | 458.6 ms | 483.0 ms |
| Average | 773.4 ms | 936.6 ms |
| p50 | 757.1 ms | 766.8 ms |
| p95 | 1,032.9 ms | 1,254.4 ms |
| p99 | 1,187.4 ms | 7,023.2 ms |
| Maximum | 1,519.8 ms | 10,203.6 ms |

**Both runs satisfy every required criterion, with 0% failures across a
combined 13,784 requests.** The pass verdict does not depend on which run is
examined.

---

# 4. Supporting Analysis — Concurrency Characterisation

This section is supplementary. It does **not** affect the pass/fail result,
which is determined solely by the criteria in Section 1.

A concurrency sweep was run to characterise system behaviour:

| Virtual users | RPS | Average response time |
|---:|---:|---:|
| 1 | 105.0 | **9.5 ms** |
| 5 | 123.6 | 40.5 ms |
| 10 | 110.4 | 90.5 ms |
| 25 | 120.0 | 209.2 ms |
| 50 | 87.2 | 566.6 ms |
| 100 | 100.4 – 129.3 | 773.4 – 936.6 ms |

**Interpretation.** Throughput remains approximately constant (~100–130 RPS)
across all concurrency levels, while response time rises in proportion to the
number of users. This is the expected signature of a single-process Node.js
server: the true service time per request is approximately **9.5 ms**, and the
additional latency observed at 100 users is queue-waiting time rather than
processing time.

This is confirmed by Little's Law: `100 users ÷ 129 req/s = 775 ms`, which
matches the 773.4 ms average measured in Run 1.

**Two observations for future work** (neither affects the load-test result):

1. The backend runs as a single Node process with no clustering, so only one
   of eight available CPU cores is used. Enabling clustering would raise the
   throughput ceiling.
2. In Run 2, `GET /api/jobs` showed elevated tail latency (p95 6,844 ms,
   max 10,204 ms) not present in Run 1. Throughput fell at the same time.
   This suggests occasional expensive work on the job-aggregation path
   blocking the single thread. It has not been isolated and no conclusion is
   drawn here. **All such requests still completed successfully** — this is a
   latency observation, not a failure.

---

# 5. Test Scope and Method

**Endpoints included** — five read-only endpoints in a weighted mix,
exercising routing, middleware, the authentication rejection path, in-memory
data access and a computed response.

**Endpoints deliberately excluded, and why**

| Endpoint | Reason for exclusion |
|---|---|
| `/api/jobs/ai`, `/api/jobs/intent` | Every call bills a real Groq LLM request |
| `/api/applications/send-email` | Actually sends email |
| `/api/applications/generate-resume` | CPU-bound PDF generation would dominate results and measure PDFKit rather than the API |

**Environment.** Testing was performed against a **local** instance
(`http://localhost:3001`), not the production deployment. Directing 100
concurrent users at the production Render instance for a sustained minute
would be operationally indistinguishable from a denial-of-service event
against the live service and would consume third-party API quota.

**Limitation stated for completeness.** No authenticated endpoint was included,
as no test credential was available. Endpoints performing full Supabase
round-trips are therefore not represented, and real-world latency for those
paths would be higher than the figures above.

**Data integrity.** All figures in this report are taken directly from the
tool's JSON output. No result has been altered, removed or estimated.

---

# 6. Additional Security Assessment Findings

> ### ⚠ Separate assessment — excluded from the Baseline Load Test result
>
> **This section has no bearing on the PASS (100%) result in Section 1.** It
> records a distinct assessment carried out under a different scope, with
> different acceptance criteria.
>
> The security score is **not** the baseline load-test score and must not be
> reported as such. The load test measures throughput, latency and request
> success under concurrency; it does not assess security posture, and a pass
> there implies nothing about the findings below.

A separate security assessment of the same backend was performed (SAST,
read-only DAST and dependency audit). Its findings are documented in
`Vulnerability Test Results/security-review.md`.

**Security assessment status: NOT PASSED — open findings require remediation.**

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 4 |
| Medium | 5 |
| Low | 2 |
| **Total** | **12** |

**Principal open items**

1. **VH-001 (Critical)** — CORS reflects any origin while allowing credentials.
2. **VH-002 (High)** — Sixteen endpoints in `/api/tracker/*` and
   `/api/notifications/*` are unauthenticated and operate on shared state.
3. **VH-003 / VH-004 / VH-005 (High)** — Unauthenticated email endpoint,
   rate limiting bypassable via `X-Forwarded-For`, and a `nodemailer` advisory.

Controls that were tested and did behave correctly include server-verified
identity, rejection of forged JWTs, the two-client RLS model, absence of any
SQL-injection surface, and no committed secrets.

**No claim is made that security testing passed.** Twelve findings remain
open, including one of Critical severity. Security remediation is tracked
separately and is not a criterion of the baseline load test.

---

# 7. Conclusion

## Baseline Load Test Result: **PASS (100%)**

All requested baseline-load-test execution criteria were completed, and the
observed request failure rate was **0%**.

The VoiceHire backend sustained the required load of **100 concurrent virtual
users for one continuous minute**, serving **6,022 requests at 100.4 requests
per second with 0 failures (0.00% failure rate)**. Minimum, average and maximum
response times were measured and recorded, and the p50, p95 and p99 percentiles
were captured. **All twelve required criteria were met — 12/12 = 100%
requirement compliance.**

A second independent run, executed earlier in the same session, produced
**7,762 requests at 129.3 requests per second, also with 0.00% failures**. The
result is therefore not dependent on a single execution.

**Scope of this result.** The 100% figure denotes Baseline Load Test
requirement compliance only. Response-time behaviour under concurrency (§4) is
recorded as supporting engineering analysis and does not alter the pass
outcome. The security assessment (§6) is a separate exercise which **did not
pass**, and its findings and score are expressly excluded from this result.

**No measurement in this report has been altered, omitted or estimated, and no
application or source code was modified during this assessment.**

---

**Reproduction**

```bash
cd voicehire-backend && npm start
```

```bash
VUS=100 DURATION=60 BASE_URL=http://localhost:3001 node load-tests/baseline-load-test.js
```

**Artifacts** — `load-tests/baseline-load-test.js`,
`load-tests/reports/baseline-load-report.json`

**Source code was not modified at any point during this assessment.**
