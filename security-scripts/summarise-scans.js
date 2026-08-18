#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   summarise-scans.js — fold scanner output into one GitHub Action Summary

   Reads whatever artifacts exist (Semgrep, npm audit, pip-audit, Trivy, the
   DAST probe) and prints Markdown. Every scanner is optional: a missing file
   is reported as "not run" rather than silently counted as zero, because a
   scan that did not happen is not a clean result.

       node summarise-scans.js <artifacts-dir>
       node summarise-scans.js <artifacts-dir> --critical-count
   ───────────────────────────────────────────────────────────────────────── */

'use strict'

const fs = require('fs')
const path = require('path')

const dir = process.argv[2] || 'artifacts'
const countOnly = process.argv.includes('--critical-count')

/** Find a file anywhere under dir (artifacts land in per-artifact subfolders). */
function find(name) {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { continue }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name === name) return full
    }
  }
  return null
}

function readJson(name) {
  const p = find(name)
  if (!p) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return null }
}

const scanners = []      // { name, ran, critical, high, medium, low, note }

/* ── Semgrep ───────────────────────────────────────────────────────────── */
const semgrep = readJson('semgrep.json')
if (semgrep && Array.isArray(semgrep.results)) {
  const sev = { ERROR: 0, WARNING: 0, INFO: 0 }
  semgrep.results.forEach(r => {
    const s = (r.extra && r.extra.severity) || 'INFO'
    sev[s] = (sev[s] || 0) + 1
  })
  scanners.push({
    name: 'Semgrep (SAST)', ran: true,
    critical: 0, high: sev.ERROR, medium: sev.WARNING, low: sev.INFO,
    note: `${semgrep.results.length} rule matches`
  })
} else {
  scanners.push({ name: 'Semgrep (SAST)', ran: false })
}

/* ── npm audit ─────────────────────────────────────────────────────────── */
const npmAudit = readJson('npm-audit.json')
if (npmAudit && npmAudit.metadata && npmAudit.metadata.vulnerabilities) {
  const v = npmAudit.metadata.vulnerabilities
  scanners.push({
    name: 'npm audit', ran: true,
    critical: v.critical || 0, high: v.high || 0,
    medium: v.moderate || 0, low: v.low || 0,
    note: `${Object.keys(npmAudit.vulnerabilities || {}).length} affected packages`
  })
} else {
  scanners.push({ name: 'npm audit', ran: false })
}

/* ── pip-audit ─────────────────────────────────────────────────────────── */
const pipAudit = readJson('pip-audit.json')
if (pipAudit) {
  const deps = Array.isArray(pipAudit) ? pipAudit : (pipAudit.dependencies || [])
  const n = deps.reduce((a, d) => a + ((d.vulns || []).length), 0)
  scanners.push({
    name: 'pip-audit', ran: true,
    critical: 0, high: n, medium: 0, low: 0, note: `${n} advisories`
  })
} else {
  scanners.push({ name: 'pip-audit', ran: false })
}

/* ── Trivy ─────────────────────────────────────────────────────────────── */
const trivy = readJson('trivy.json')
if (trivy && Array.isArray(trivy.Results)) {
  const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  trivy.Results.forEach(r => (r.Vulnerabilities || []).forEach(v => {
    c[v.Severity] = (c[v.Severity] || 0) + 1
  }))
  scanners.push({
    name: 'Trivy (filesystem)', ran: true,
    critical: c.CRITICAL, high: c.HIGH, medium: c.MEDIUM, low: c.LOW,
    note: `${trivy.Results.length} targets`
  })
} else {
  scanners.push({ name: 'Trivy (filesystem)', ran: false })
}

/* ── DAST ──────────────────────────────────────────────────────────────── */
const dast = readJson('dast-report.json')
if (dast) {
  scanners.push({
    name: 'API probe (DAST)', ran: true,
    critical: dast.critical || 0, high: dast.high || 0,
    medium: dast.medium || 0, low: dast.low || 0,
    note: dast.target || ''
  })
} else {
  scanners.push({ name: 'API probe (DAST)', ran: false, note: 'no API URL supplied' })
}

/* ── Totals ────────────────────────────────────────────────────────────── */
const ran = scanners.filter(s => s.ran)
const total = k => ran.reduce((a, s) => a + (s[k] || 0), 0)
const criticalTotal = total('critical')

if (countOnly) {
  process.stdout.write(String(criticalTotal))
  process.exit(0)
}

/* ── Markdown ──────────────────────────────────────────────────────────── */
const L = []
L.push('## Security Review Summary', '')
L.push('| Scanner | Status | Critical | High | Medium | Low | Notes |')
L.push('|---|---|---:|---:|---:|---:|---|')
for (const s of scanners) {
  if (s.ran) {
    L.push(`| ${s.name} | ran | ${s.critical} | ${s.high} | ${s.medium} | ${s.low} | ${s.note || ''} |`)
  } else {
    L.push(`| ${s.name} | **not run** | – | – | – | – | ${s.note || 'no output produced'} |`)
  }
}
L.push('')
L.push(`**Totals across scanners that ran** — Critical **${criticalTotal}**, ` +
       `High ${total('high')}, Medium ${total('medium')}, Low ${total('low')}`)
L.push('')

if (scanners.some(s => !s.ran)) {
  L.push('> Scanners marked **not run** produced no output. That is not the same as ' +
         'a clean result — treat those areas as unassessed for this run.')
  L.push('')
}

if (criticalTotal > 0) {
  L.push(`### This run will FAIL — ${criticalTotal} critical finding(s)`)
  L.push('')
  L.push('Only Critical severity blocks the build. High, Medium and Low are reported ' +
         'but do not fail the pipeline.')
} else {
  L.push('### No critical findings — build passes')
  L.push('')
  L.push('Lower-severity issues are reported above and in the uploaded artifacts.')
}

console.log(L.join('\n'))
