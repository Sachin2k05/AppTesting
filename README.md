# VoiceHire — QA & Testing Reports

Test artefacts and assessment reports for **VoiceHire**, a voice-first AI
recruiter built for blind and visually impaired candidates.

[![Test Reports](https://github.com/Sachin2k05/AppTesting/actions/workflows/test-reports.yml/badge.svg)](https://github.com/Sachin2k05/AppTesting/actions/workflows/test-reports.yml)

---

## Baseline Load Test: **PASS (100%)**

All requested baseline-load-test execution criteria were completed, and the
observed request failure rate was **0%**.

| Criterion | Requirement | Measured | Status |
|---|---|---|:--:|
| Virtual users | 100 concurrent | **100** | PASS |
| Continuous execution | 1 minute | **60.007 s** | PASS |
| Requests per second | measure and record | **100.4 req/sec** | PASS |
| Minimum response time | measure and record | **483.0 ms** | PASS |
| Average response time | measure and record | **936.6 ms** | PASS |
| Maximum response time | measure and record | **10,203.6 ms** | PASS |
| p50 | include if available | **766.8 ms** | PASS |
| p95 | include if available | **1,254.4 ms** | PASS |
| p99 | include if available | **7,023.2 ms** | PASS |
| Total requests | record | **6,022** | PASS |
| Failed requests | record | **0** | PASS |
| Failure percentage | 0% required | **0.00%** | PASS |

**Compliance: 12 / 12 = 100%**

> The 100% denotes **Baseline Load Test requirement compliance only**. It is not
> a security score and not a performance-headroom rating. See
> [`load-tests/BASELINE-LOAD-TEST-REPORT.md`](load-tests/BASELINE-LOAD-TEST-REPORT.md).

---

## Contents

| Folder | What it holds |
|---|---|
| [`selenium-tests/`](selenium-tests/) | Web E2E suite — **310 documented cases**, 46 automated |
| [`appium-tests/`](appium-tests/) | Android E2E suite — **307 documented cases**, 55 automated |
| [`load-tests/`](load-tests/) | Baseline load test, generator and raw results |
| [`security-reports/`](security-reports/) | Security assessment — 12 findings |
| [`security-scripts/`](security-scripts/) | Scanning and report-generation helpers |

---

## 1. Selenium — Web E2E

`selenium-tests/tests/login-tests.js` drives the real login flow with Selenium
WebDriver 4 against Chrome. Every selector was read from the application's
`index.html` rather than invented.

**46 automated cases** across page load, login presentation, the guest flow,
Google OAuth initiation, accessibility and resilience.
**310 documented cases** in `VoiceHire-Web-E2E-TestCases.xlsx`.

```bash
cd voice_hire_v2 && npm start          # serve the app on :8080
cd selenium-tests && npm install && npm test
```

## 2. Appium — Android E2E

`appium-tests/tests/app-tests.js` drives the installed Android app. Selectors
are accessibility ids taken from the app's own `accessibilityLabel` props.

**55 automated cases** across launch, sign-in, guest flow, conversation UI, a
full typed turn, permissions, backgrounding and TalkBack accessibility.
**307 documented cases** in `VoiceHire-Android-E2E-TestCases.xlsx`.

```bash
cd appium-tests && npm install
npx appium driver install uiautomator2
npx appium                              # second terminal
DEVICE=<your-device> npm test
```

## 3. Baseline Load Test

100 virtual users held for 60 seconds against a weighted mix of read-only
endpoints, using a dependency-free generator that also measures its own
event-loop lag so client saturation cannot be mistaken for server latency.

```bash
VUS=100 DURATION=60 BASE_URL=http://localhost:3001 node load-tests/baseline-load-test.js
```

## 4. Security Assessment

SAST, read-only DAST and a dependency audit of the backend. **12 findings**
(1 Critical, 4 High, 5 Medium, 2 Low).

**This assessment did not pass** — findings remain open and require
remediation. It is reported separately and has no bearing on the load-test
result above.

---

## Continuous Integration

**`test-reports.yml`** — runs on every push and pull request, with **one job per
test discipline**:

| Job | Excel artifact |
|---|---|
| 1 · Selenium — Web E2E | `1-selenium-web-e2e-report` |
| 2 · Appium — Android E2E | `2-appium-android-e2e-report` |
| 3 · Baseline Load Test | `3-baseline-load-test-report` |
| 4 · Security Assessment | `4-security-assessment-report` |
| 5 · Combined bundle | **`0-ALL-EXCEL-REPORTS`** — all five workbooks in one download |

### Downloading the Excel reports

Open **Actions → Test Reports → the latest run**, scroll to **Artifacts** at the
bottom of the page, and download `0-ALL-EXCEL-REPORTS` for everything at once,
or an individual artifact for one discipline. Artifacts are retained 90 days.

Jobs 3 and 4 do real verification: the load-test job asserts all twelve
acceptance criteria against the raw JSON and cross-checks the workbook against
it, failing the build on any mismatch. Jobs 1 and 2 validate and publish their
suites but **do not execute them live** — Selenium needs the web app served and
Appium needs a physical Android device, neither of which exists on a hosted
runner. Each job states this in its own summary.

**`security-review.yml`** — manual dispatch only. It scans a *backend*
codebase; this repository holds reports, so running it here automatically would
scan nothing useful.

---

## Honest scope notes

These reports state what was and was not verified, deliberately:

- **Automation status records what is implemented, not what passed.** The
  spreadsheets do not carry pass/fail results; run the suites to obtain those.
- **Google OAuth completion is not automated** in either suite — it needs live
  credentials, and scripting Google's login violates their terms.
- **Audio cannot be asserted by Appium.** The listening beep and phone-number
  read-back require a human listener and are marked Manual.
- **No authenticated endpoint was load-tested** (no test credential available),
  so Supabase round-trip latency is not represented and real-world figures will
  be higher.
- **Load testing ran against localhost**, never the production deployment.
