#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   baseline-load-test.js — baseline / load test for the VoiceHire backend

   100 virtual users, held for 60 seconds, against a realistic mix of
   read-only endpoints. Reports requests per second, min / average / max
   response time, percentiles, and the status-code distribution.

   ── Why percentiles, not just the average ─────────────────────────────────
   An average hides the users having a bad time. If 95 requests take 50 ms and
   5 take 3 s, the average is a comfortable 197 ms while one user in twenty
   waits three seconds. p95 and p99 are what tell you whether the system is
   actually fast, so they are reported alongside the average you asked for.

   ── Target: localhost, deliberately ───────────────────────────────────────
   Pointing 100 concurrent users at the Render free-tier production instance
   for a minute is operationally indistinguishable from a denial-of-service
   attack on your own service: it would exhaust the instance, burn Supabase
   and Groq quota, and risk the host throttling or suspending the deployment.
   BASE_URL defaults to localhost for that reason. It can be overridden, but
   do not point this at production.

   ── Endpoints deliberately EXCLUDED ───────────────────────────────────────
     /api/jobs/ai, /api/jobs/intent    every call bills a real Groq request
     /api/applications/send-email      actually sends mail
     /api/applications/generate-resume CPU-bound PDF work; would dominate the
                                       numbers and tells you about PDFKit, not
                                       about the API

   ── Client saturation is measured ─────────────────────────────────────────
   A load test whose generator is itself the bottleneck reports the client's
   limits and calls them the server's. Event-loop lag is sampled throughout; if
   it is high the report says the numbers are client-limited rather than
   presenting them as a server measurement.

   Usage
       node baseline-load-test.js
       VUS=100 DURATION=60 BASE_URL=http://localhost:3001 node baseline-load-test.js
   ───────────────────────────────────────────────────────────────────────── */

'use strict'

const fs = require('fs')
const path = require('path')

const BASE     = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')
const VUS      = Number(process.env.VUS || 100)
const DURATION = Number(process.env.DURATION || 60)          // seconds
const WARMUP   = Number(process.env.WARMUP || 5)             // seconds, excluded
const TIMEOUT  = Number(process.env.REQ_TIMEOUT_MS || 30000)

/* A realistic read-only mix. `weight` is how often a virtual user picks it. */
const SCENARIOS = [
  { name: 'GET /api/jobs',                    path: '/api/jobs',                    weight: 3 },
  { name: 'GET /api/matching/recommendations', path: '/api/matching/recommendations', weight: 2 },
  { name: 'GET /api/tracker/dashboard',       path: '/api/tracker/dashboard',       weight: 2 },
  { name: 'GET /api/notifications',           path: '/api/notifications',           weight: 2 },
  { name: 'GET /api/auth/me (unauthenticated)', path: '/api/auth/me',               weight: 1 }
]

const PICK = []
SCENARIOS.forEach((s, i) => { for (let w = 0; w < s.weight; w++) PICK.push(i) })

/* ── Collection ────────────────────────────────────────────────────────── */
const stats = SCENARIOS.map(s => ({ name: s.name, path: s.path, times: [], codes: {}, errors: 0 }))
let running = true
let counting = false          // false during warmup
let totalCounted = 0

/* Event-loop lag: the honesty check on the generator itself. */
const lagSamples = []
function sampleLag() {
  const t = process.hrtime.bigint()
  setTimeout(() => {
    const drift = Number(process.hrtime.bigint() - t) / 1e6 - 20
    lagSamples.push(Math.max(0, drift))
    if (running) sampleLag()
  }, 20)
}

async function one(i) {
  const s = SCENARIOS[i]
  const bucket = stats[i]
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  const t0 = process.hrtime.bigint()
  try {
    const res = await fetch(BASE + s.path, { signal: ctrl.signal })
    await res.arrayBuffer()                       // include body transfer
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    if (counting) {
      bucket.times.push(ms)
      bucket.codes[res.status] = (bucket.codes[res.status] || 0) + 1
      totalCounted++
    }
  } catch (e) {
    if (counting) { bucket.errors++; totalCounted++ }
  } finally {
    clearTimeout(timer)
  }
}

/** One virtual user: request, then immediately the next. Closed-loop. */
async function virtualUser() {
  while (running) {
    await one(PICK[Math.floor(Math.random() * PICK.length)])
  }
}

/* ── Statistics ────────────────────────────────────────────────────────── */
function pct(sorted, p) {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}
const r1 = n => Math.round(n * 10) / 10

function summarise(times) {
  if (!times.length) return null
  const s = [...times].sort((a, b) => a - b)
  return {
    count: s.length,
    min: r1(s[0]),
    avg: r1(s.reduce((a, b) => a + b, 0) / s.length),
    p50: r1(pct(s, 50)),
    p95: r1(pct(s, 95)),
    p99: r1(pct(s, 99)),
    max: r1(s[s.length - 1])
  }
}

function bar(v, max, width = 28) {
  if (!max) return ''
  return '#'.repeat(Math.max(1, Math.round((v / max) * width)))
}

/* ── Run ───────────────────────────────────────────────────────────────── */
;(async () => {
  console.log('='.repeat(74))
  console.log(' VoiceHire Backend — Baseline / Load Test')
  console.log('='.repeat(74))
  console.log(` target        : ${BASE}`)
  console.log(` virtual users : ${VUS}`)
  console.log(` duration      : ${DURATION}s  (plus ${WARMUP}s warm-up, excluded)`)
  console.log(` scenarios     : ${SCENARIOS.length} read-only endpoints`)
  console.log('='.repeat(74))

  /* Refuse to start if the target is not up — otherwise every request errors
     and the report becomes a meaningless wall of zeros. */
  try {
    const probe = await fetch(BASE + '/api/jobs', { signal: AbortSignal.timeout(8000) })
    console.log(`\n pre-flight    : ${BASE}/api/jobs -> ${probe.status}\n`)
  } catch (e) {
    console.error(`\nTarget unreachable at ${BASE} (${e.message}).`)
    console.error('Start the backend first:  cd voicehire-backend && npm start\n')
    process.exit(2)
  }

  sampleLag()
  const users = Array.from({ length: VUS }, () => virtualUser())

  console.log(` warming up ${WARMUP}s (results discarded) ...`)
  await new Promise(r => setTimeout(r, WARMUP * 1000))
  counting = true

  const started = Date.now()
  const tick = setInterval(() => {
    const el = (Date.now() - started) / 1000
    process.stdout.write(`\r  measuring ... ${el.toFixed(0).padStart(2)}s / ${DURATION}s   ` +
                         `${totalCounted} requests   ${(totalCounted / el).toFixed(0)} req/s   `)
  }, 1000)

  await new Promise(r => setTimeout(r, DURATION * 1000))
  const elapsed = (Date.now() - started) / 1000
  running = false
  counting = false
  clearInterval(tick)
  process.stdout.write('\r' + ' '.repeat(78) + '\r')
  await Promise.allSettled(users)

  /* ── Report ──────────────────────────────────────────────────────────── */
  const all = stats.flatMap(s => s.times)
  const overall = summarise(all)
  const errors = stats.reduce((a, s) => a + s.errors, 0)
  const rps = totalCounted / elapsed
  const avgLag = lagSamples.length
    ? lagSamples.reduce((a, b) => a + b, 0) / lagSamples.length : 0
  const maxLag = lagSamples.length ? Math.max(...lagSamples) : 0

  console.log('\n' + '='.repeat(74))
  console.log(' RESULTS')
  console.log('='.repeat(74))
  console.log(` duration           : ${elapsed.toFixed(1)}s`)
  console.log(` total requests     : ${totalCounted}`)
  console.log(` failed requests    : ${errors}` +
              (totalCounted ? `  (${r1(errors / totalCounted * 100)}%)` : ''))
  console.log('')
  console.log(` REQUESTS PER SECOND: ${rps.toFixed(1)} req/sec`)
  console.log('')
  if (overall) {
    console.log(' RESPONSE TIME')
    console.log(`   min              : ${overall.min} ms`)
    console.log(`   average          : ${overall.avg} ms`)
    console.log(`   p50 (median)     : ${overall.p50} ms`)
    console.log(`   p95              : ${overall.p95} ms`)
    console.log(`   p99              : ${overall.p99} ms`)
    console.log(`   max              : ${overall.max} ms`)
  }

  console.log('\n PER ENDPOINT')
  const worst = Math.max(...stats.map(s => (summarise(s.times) || { p95: 0 }).p95))
  stats.forEach(s => {
    const m = summarise(s.times)
    if (!m) { console.log(`   ${s.name.padEnd(38)} no data`); return }
    const codes = Object.entries(s.codes).map(([c, n]) => `${c}:${n}`).join(' ')
    console.log(`   ${s.name.padEnd(38)} n=${String(m.count).padStart(5)}  ` +
                `avg ${String(m.avg).padStart(7)}ms  p95 ${String(m.p95).padStart(7)}ms  ` +
                `max ${String(m.max).padStart(7)}ms`)
    console.log(`   ${' '.repeat(38)} ${codes}${s.errors ? `  errors:${s.errors}` : ''}  ${bar(m.p95, worst)}`)
  })

  console.log('\n GENERATOR HEALTH (is the client the bottleneck?)')
  console.log(`   event-loop lag   : avg ${r1(avgLag)} ms, max ${r1(maxLag)} ms`)
  const clientLimited = avgLag > 50
  console.log(`   verdict          : ${clientLimited
    ? 'CLIENT-LIMITED — the generator was saturated. Treat these numbers as a floor.'
    : 'healthy — the numbers reflect the server, not the load generator.'}`)

  console.log('\n' + '='.repeat(74))

  const report = {
    target: BASE, virtualUsers: VUS, durationSeconds: elapsed,
    warmupSecondsExcluded: WARMUP,
    executedAt: new Date().toISOString(),
    requestsPerSecond: r1(rps),
    totalRequests: totalCounted, failedRequests: errors,
    errorRatePercent: totalCounted ? r1(errors / totalCounted * 100) : 0,
    responseTimeMs: overall,
    perEndpoint: stats.map(s => ({
      name: s.name, path: s.path,
      metrics: summarise(s.times), statusCodes: s.codes, errors: s.errors
    })),
    generator: { eventLoopLagAvgMs: r1(avgLag), eventLoopLagMaxMs: r1(maxLag), clientLimited },
    excludedEndpoints: [
      '/api/jobs/ai and /api/jobs/intent — each call bills a real Groq request',
      '/api/applications/send-email — actually sends mail',
      '/api/applications/generate-resume — CPU-bound PDF work would dominate the numbers'
    ]
  }

  const out = path.join(__dirname, 'reports')
  fs.mkdirSync(out, { recursive: true })
  const file = path.join(out, 'baseline-load-report.json')
  fs.writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(` report written to ${path.relative(process.cwd(), file)}`)

  process.exit(0)
})().catch(e => { console.error('load test failed:', e.message); process.exit(1) })
