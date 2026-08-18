#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   api-security-check.js — non-destructive API security probes

   DETECTION ONLY. Every request below is a GET, or an OPTIONS preflight, or a
   POST to an endpoint whose failure path is a 400/401. Nothing writes, deletes,
   sends email, or modifies state. That restraint is deliberate: a security
   check that damages the system it is checking is not a security check.

   Usage
       API_BASE_URL=https://staging.example.com node api-security-check.js
       API_BASE_URL=http://localhost:3001 node api-security-check.js

   Writes dast-report.json and exits non-zero only if a CRITICAL is found.
   ───────────────────────────────────────────────────────────────────────── */

'use strict'

const fs = require('fs')

const BASE = (process.env.API_BASE_URL || '').replace(/\/+$/, '')
if (!BASE) {
  console.error('API_BASE_URL is required.')
  process.exit(2)
}

const TIMEOUT = Number(process.env.PROBE_TIMEOUT_MS || 20000)
const findings = []
const notes = []

/* Reachability tally. A probe that never connected proves nothing, and a run
   where NOTHING connected must not be reported as a clean bill of health —
   that is the difference between "no vulnerabilities found" and "no scan
   happened". Tracked here and enforced at exit. */
let attempts = 0
let connected = 0

function record(severity, id, title, detail, evidence) {
  findings.push({ id, severity, title, detail, evidence })
  const tag = severity.toUpperCase().padEnd(8)
  console.log(`  ${tag} ${id}  ${title}`)
  if (evidence) console.log(`           ${evidence}`)
}

async function req(path, options = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  attempts++
  try {
    const res = await fetch(BASE + path, { ...options, signal: ctrl.signal, redirect: 'manual' })
    const text = await res.text().catch(() => '')
    connected++
    return { status: res.status, headers: res.headers, body: text }
  } catch (e) {
    return { status: 0, headers: new Headers(), body: '', error: e.message }
  } finally {
    clearTimeout(t)
  }
}

/* ── 1. Authentication ─────────────────────────────────────────────────── */
async function checkAuth() {
  console.log('\n[1] Authentication')
  const protectedPaths = ['/api/profile', '/api/graph', '/api/conversation', '/api/applications']

  for (const p of protectedPaths) {
    const none = await req(p)
    if (none.status === 200) {
      record('critical', 'DAST-AUTH-001', 'Protected endpoint served without a token',
        `${p} returned 200 with no Authorization header.`, `GET ${p} -> 200`)
    } else if (none.status === 0) {
      notes.push(`${p}: unreachable (${none.error})`)
    }
  }

  /* Forged tokens. A correct server rejects all three. */
  const forged = [
    ['garbage', 'Bearer not-a-real-token'],
    ['alg=none', 'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiIxIn0.'],
    ['bad signature', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIn0.AAAA']
  ]
  for (const [label, header] of forged) {
    const r = await req('/api/profile', { headers: { Authorization: header } })
    if (r.status === 200) {
      record('critical', 'DAST-AUTH-002', `Forged token accepted (${label})`,
        'The server honoured a token it should not trust.', `GET /api/profile -> 200`)
    }
  }
  console.log('  (no output above this line means every forged token was rejected)')
}

/* ── 2. Unauthenticated data exposure ──────────────────────────────────── */
async function checkExposure() {
  console.log('\n[2] Unauthenticated data exposure')
  const candidates = [
    '/api/tracker/dashboard', '/api/tracker/saved', '/api/tracker/analytics',
    '/api/notifications', '/api/notifications/unread',
    '/api/matching/recommendations'
  ]
  for (const p of candidates) {
    const r = await req(p)
    if (r.status === 200 && r.body && r.body.length > 2) {
      record('high', 'DAST-AC-001', 'Endpoint returns data without authentication',
        `${p} served a body with no credential.`,
        `GET ${p} -> 200, ${r.body.length} bytes`)
    }
  }
}

/* ── 3. CORS ───────────────────────────────────────────────────────────── */
async function checkCors() {
  console.log('\n[3] CORS')
  const evil = 'https://evil.example.com'
  const r = await req('/api/profile', { method: 'OPTIONS', headers: { Origin: evil } })
  const allow = r.headers.get('access-control-allow-origin')
  const creds = r.headers.get('access-control-allow-credentials')

  if (allow === evil || allow === '*') {
    const withCreds = String(creds).toLowerCase() === 'true'
    record(withCreds ? 'critical' : 'medium', 'DAST-CORS-001',
      withCreds ? 'Any origin reflected AND credentials allowed'
                : 'Any origin permitted',
      withCreds
        ? 'A hostile page can read authenticated responses cross-origin.'
        : 'Wildcard CORS. Lower risk without credentials, still too broad.',
      `Origin: ${evil} -> Allow-Origin: ${allow}, Allow-Credentials: ${creds}`)
  }
}

/* ── 4. Security headers ───────────────────────────────────────────────── */
async function checkHeaders() {
  console.log('\n[4] Security headers')
  const r = await req('/')
  const expected = {
    'strict-transport-security': 'medium',
    'content-security-policy': 'medium',
    'x-content-type-options': 'low',
    'x-frame-options': 'low',
    'referrer-policy': 'low'
  }
  const missing = []
  for (const [h, sev] of Object.entries(expected)) {
    if (!r.headers.get(h)) missing.push({ h, sev })
  }
  if (missing.length) {
    const worst = missing.some(m => m.sev === 'medium') ? 'medium' : 'low'
    record(worst, 'DAST-HDR-001', 'Missing security headers',
      'Defence-in-depth headers are absent.',
      'missing: ' + missing.map(m => m.h).join(', '))
  }
}

/* ── 5. Error handling ─────────────────────────────────────────────────── */
async function checkErrorLeakage() {
  console.log('\n[5] Error leakage')
  const r = await req('/api/definitely-not-a-real-route-' + Date.now())
  const leaky = /at\s+\/|node_modules|Error:\s|\bstack\b|SequelizeError|SQLSTATE|postgres/i
  if (leaky.test(r.body)) {
    record('medium', 'DAST-ERR-001', 'Error response leaks internals',
      'A 404/500 body contained a stack trace or driver detail.',
      r.body.slice(0, 160))
  }
}

/* ── 6. Rate limiting (probe, not brute force) ─────────────────────────── */
async function checkRateLimit() {
  console.log('\n[6] Rate limiting')
  /* Deliberately gentle: 12 GETs to a read-only endpoint, then the same count
     with a rotating X-Forwarded-For. If the first burst throttles and the
     second does not, the limiter is header-spoofable. This is far below any
     threshold that would constitute a denial-of-service attempt. */
  const path = '/api/jobs'
  let throttledPlain = false
  for (let i = 0; i < 12; i++) {
    const r = await req(path)
    if (r.status === 429) { throttledPlain = true; break }
  }
  let throttledSpoofed = false
  for (let i = 0; i < 12; i++) {
    const r = await req(path, { headers: { 'X-Forwarded-For': `10.0.${i}.${i + 1}` } })
    if (r.status === 429) { throttledSpoofed = true; break }
  }
  if (throttledPlain && !throttledSpoofed) {
    record('high', 'DAST-RATE-001', 'Rate limiting bypassable via X-Forwarded-For',
      'Throttling applied to a plain client but not when the header was rotated.',
      'same volume, rotating XFF, no 429')
  } else if (!throttledPlain) {
    notes.push('rate limiting: no 429 within a deliberately small probe — not conclusive')
  }
}

/* ── Run ───────────────────────────────────────────────────────────────── */
;(async () => {
  console.log('='.repeat(70))
  console.log(` Non-destructive API security check — ${BASE}`)
  console.log('='.repeat(70))

  await checkAuth()
  await checkExposure()
  await checkCors()
  await checkHeaders()
  await checkErrorLeakage()
  await checkRateLimit()

  const by = s => findings.filter(f => f.severity === s).length
  const summary = {
    target: BASE,
    executedAt: new Date().toISOString(),
    critical: by('critical'), high: by('high'),
    medium: by('medium'), low: by('low'),
    findings, notes
  }
  fs.writeFileSync('dast-report.json', JSON.stringify(summary, null, 2))

  console.log('\n' + '='.repeat(70))
  console.log(` critical ${summary.critical}  high ${summary.high}  ` +
              `medium ${summary.medium}  low ${summary.low}`)
  if (notes.length) notes.forEach(n => console.log('  note: ' + n))
  console.log(' report written to dast-report.json')
  console.log('='.repeat(70))

  /* Unreachable target => UNASSESSED, not clean. Exiting 0 here would let a
     misconfigured URL masquerade as a passing security gate. */
  if (connected === 0) {
    console.error(`
TARGET UNREACHABLE — ${attempts} probes, 0 responses from ${BASE}.`)
    console.error('Nothing was assessed. This is NOT a pass.')
    process.exit(2)
  }
  if (connected < attempts / 2) {
    console.warn(`
WARNING: only ${connected}/${attempts} probes connected. Results are partial.`)
  }

  process.exit(summary.critical > 0 ? 1 : 0)
})().catch(e => {
  console.error('probe failed:', e.message)
  process.exit(2)
})
