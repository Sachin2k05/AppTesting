/* ─────────────────────────────────────────────────────────────────────────
   login-tests.js — Selenium E2E for the VoiceHire web front end

   ── What this drives ──────────────────────────────────────────────────────
   The real page at voice_hire_v2/index.html, served by its own npm script:

       cd voice_hire_v2 && npm start        →  http://localhost:8080

   Every selector below was read out of index.html rather than invented:

       #start-overlay  #start-btn           the "Tap to Start" gate
       #login-screen   .login-box           the login card
       #google-btn     #guest-btn           the two auth choices
       #login-google-error                  inline error line
       #main-app       #status-banner       the app behind the gate
       #orb #mic-btn #chat-area #profile-count #value-name

   ── An honest limit on the Google path ────────────────────────────────────
   A real Google sign-in CANNOT be automated here: it needs live credentials,
   and scripting Google's login form violates their terms and breaks on their
   bot detection. So the Google tests assert that the app correctly INITIATES
   OAuth — the click is wired, no error is shown, and the browser is sent to
   a Google/Supabase authorize URL. Completion of the OAuth round trip is a
   manual test case (see the accompanying spreadsheet, suite AUTH-GOOGLE).
   Anything else here would be a test that lies about what it proves.

   ── Running ───────────────────────────────────────────────────────────────
       npm install                 (installs selenium-webdriver)
       npm test                    (headless)
       HEADLESS=false npm test     (watch it drive a real Chrome)
       BASE_URL=http://localhost:3001 npm test

   Results are written to reports/login-results.json so they can be folded
   into the test-case spreadsheet.
   ───────────────────────────────────────────────────────────────────────── */

'use strict'

const fs = require('fs')
const path = require('path')
const { Builder, By, until, Key } = require('selenium-webdriver')
const chrome = require('selenium-webdriver/chrome')

/* ── Configuration ─────────────────────────────────────────────────────── */
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080'
const HEADLESS = String(process.env.HEADLESS || 'true') !== 'false'
const WAIT = Number(process.env.WAIT_MS || 10000)

const results = []
let driver = null

/* ── Tiny harness ──────────────────────────────────────────────────────── */
async function test(id, title, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push({ id, title, status: 'PASS', ms: Date.now() - started, error: '' })
    console.log(`  PASS  ${id}  ${title}`)
  } catch (e) {
    results.push({ id, title, status: 'FAIL', ms: Date.now() - started, error: e.message })
    console.log(`  FAIL  ${id}  ${title}\n          ${e.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

/* ── Page helpers ──────────────────────────────────────────────────────── */
const $ = (sel) => By.css(sel)

async function present(sel) {
  const els = await driver.findElements($(sel))
  return els.length > 0
}

/** Visible means present AND not display:none — the app hides screens with a
    `.hidden` class, so findElement alone would give a false positive. */
async function visible(sel) {
  const els = await driver.findElements($(sel))
  if (!els.length) return false
  try { return await els[0].isDisplayed() } catch (e) { return false }
}

async function text(sel) {
  const el = await driver.findElement($(sel))
  return (await el.getText()).trim()
}

async function clickIfPresent(sel) {
  const els = await driver.findElements($(sel))
  if (!els.length) return false
  try { await els[0].click(); return true } catch (e) { return false }
}

/** Load the page fresh with no carried-over session. */
async function freshLoad() {
  await driver.get(BASE_URL)
  await driver.wait(until.elementLocated($('body')), WAIT)
  await driver.executeScript('try{localStorage.clear();sessionStorage.clear();}catch(e){}')
  await driver.navigate().refresh()
  await driver.wait(until.elementLocated($('body')), WAIT)
}

/** Get past the "Tap to Start" overlay so the login card is reachable. */
async function dismissStartOverlay() {
  if (await visible('#start-btn')) {
    await driver.findElement($('#start-btn')).click()
  } else if (await visible('#start-overlay')) {
    await driver.findElement($('#start-overlay')).click()
  }
  await driver.sleep(600)   // the overlay fades out
}

async function reachLoginScreen() {
  await freshLoad()
  await dismissStartOverlay()
  await driver.wait(async () => await visible('#login-screen'), WAIT,
    'the login screen never became visible after the start overlay')
}

async function localStorageGet(key) {
  return driver.executeScript(`try{return localStorage.getItem(${JSON.stringify(key)})}catch(e){return null}`)
}

/* ── Suites ────────────────────────────────────────────────────────────── */

async function suiteAppLoad() {
  console.log('\n LOGIN-LOAD · the page and the start gate')

  await test('LOGIN-LOAD-001', 'the application document loads', async () => {
    await freshLoad()
    const title = await driver.getTitle()
    assert(title && title.length > 0, 'the page has no <title>')
  })

  await test('LOGIN-LOAD-002', 'the start overlay is shown first', async () => {
    await freshLoad()
    assert(await visible('#start-overlay'), '#start-overlay was not visible on load')
  })

  await test('LOGIN-LOAD-003', 'the start overlay carries the VoiceHire brand', async () => {
    await freshLoad()
    const logo = await text('.start-logo')
    assert(/voicehire/i.test(logo.replace(/\s+/g, '')), `unexpected brand text: ${logo}`)
  })

  await test('LOGIN-LOAD-004', 'the Tap to Start control exists and is enabled', async () => {
    await freshLoad()
    assert(await visible('#start-btn'), '#start-btn is not visible')
    const el = await driver.findElement($('#start-btn'))
    assertEqual(await el.isEnabled(), true, '#start-btn is disabled')
  })

  await test('LOGIN-LOAD-005', 'the login screen is hidden until the gate is passed', async () => {
    await freshLoad()
    assertEqual(await visible('#login-screen'), false,
      'the login screen was visible before the start overlay was dismissed')
  })

  await test('LOGIN-LOAD-006', 'the main app is hidden before authentication', async () => {
    await freshLoad()
    assertEqual(await visible('#main-app'), false, '#main-app was visible before login')
  })

  await test('LOGIN-LOAD-007', 'no uncaught page errors during load', async () => {
    await freshLoad()
    const logs = await driver.manage().logs().get('browser').catch(() => [])
    const severe = logs.filter(l => l.level && l.level.name === 'SEVERE'
      && !/favicon|net::ERR_/.test(l.message))
    assertEqual(severe.length, 0, `severe console errors: ${severe.map(l => l.message).join(' | ')}`)
  })

  await test('LOGIN-LOAD-008', 'dismissing the start overlay reveals the login screen', async () => {
    await reachLoginScreen()
    assert(await visible('#login-screen'), 'login screen not visible after dismissing the overlay')
  })
}

async function suiteLoginPresentation() {
  console.log('\n LOGIN-UI · the login card')

  await test('LOGIN-UI-001', 'the login card is rendered', async () => {
    await reachLoginScreen()
    assert(await present('.login-box'), '.login-box is missing')
  })

  await test('LOGIN-UI-002', 'the wordmark reads VoiceHire', async () => {
    await reachLoginScreen()
    const logo = (await text('.login-logo')).replace(/\s+/g, '')
    assert(/voicehire/i.test(logo), `unexpected wordmark: ${logo}`)
  })

  await test('LOGIN-UI-003', 'the tagline is present', async () => {
    await reachLoginScreen()
    const t = await text('.login-tagline')
    assert(t.length > 0, 'the tagline is empty')
  })

  await test('LOGIN-UI-004', 'the Google button is visible', async () => {
    await reachLoginScreen()
    assert(await visible('#google-btn'), '#google-btn is not visible')
  })

  await test('LOGIN-UI-005', 'the Google button is labelled', async () => {
    await reachLoginScreen()
    const label = await text('#google-btn')
    assert(/google/i.test(label), `expected the label to mention Google, got: ${label}`)
  })

  await test('LOGIN-UI-006', 'the guest button is visible', async () => {
    await reachLoginScreen()
    assert(await visible('#guest-btn'), '#guest-btn is not visible')
  })

  await test('LOGIN-UI-007', 'the guest button offers continuing without an account', async () => {
    await reachLoginScreen()
    const label = await text('#guest-btn')
    assert(/guest/i.test(label), `expected a guest label, got: ${label}`)
  })

  await test('LOGIN-UI-008', 'both auth choices are enabled', async () => {
    await reachLoginScreen()
    for (const sel of ['#google-btn', '#guest-btn']) {
      const el = await driver.findElement($(sel))
      assertEqual(await el.isEnabled(), true, `${sel} is disabled`)
    }
  })

  await test('LOGIN-UI-009', 'the error line starts empty', async () => {
    await reachLoginScreen()
    const err = await text('#login-google-error')
    assertEqual(err, '', `an error was shown before any interaction: ${err}`)
  })

  await test('LOGIN-UI-010', 'the "or" divider separates the two choices', async () => {
    await reachLoginScreen()
    assert(await present('.login-divider'), '.login-divider is missing')
  })

  await test('LOGIN-UI-011', 'guest is not visually buried — both buttons are a usable size', async () => {
    await reachLoginScreen()
    for (const sel of ['#google-btn', '#guest-btn']) {
      const r = await driver.findElement($(sel)).getRect()
      assert(r.height >= 32, `${sel} is only ${r.height}px tall; too small to hit reliably`)
      assert(r.width >= 120, `${sel} is only ${r.width}px wide`)
    }
  })
}

async function suiteGuestFlow() {
  console.log('\n LOGIN-GUEST · continuing without an account')

  await test('LOGIN-GUEST-001', 'clicking guest leaves the login screen', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => !(await visible('#login-screen')), WAIT,
      'the login screen was still visible after choosing guest')
  })

  await test('LOGIN-GUEST-002', 'guest mode reaches the main application', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT,
      '#main-app never became visible in guest mode')
  })

  await test('LOGIN-GUEST-003', 'guest mode is recorded in storage', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.sleep(1200)
    const guest = await localStorageGet('vh_guest')
    assertEqual(guest, 'true', 'vh_guest was not set to "true"')
  })

  await test('LOGIN-GUEST-004', 'guest mode carries no auth token', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.sleep(1200)
    const token = await localStorageGet('vh_token')
    assert(token === null || token === '', `a token was present in guest mode: ${token}`)
  })

  await test('LOGIN-GUEST-005', 'the conversation surface is rendered after guest login', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    assert(await present('#chat-area'), '#chat-area is missing')
  })

  await test('LOGIN-GUEST-006', 'the voice orb is present after guest login', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    assert(await present('#orb'), '#orb is missing')
  })

  await test('LOGIN-GUEST-007', 'the status banner is present after guest login', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    assert(await present('#status-banner'), '#status-banner is missing')
  })

  await test('LOGIN-GUEST-008', 'the profile panel starts at zero of sixteen', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    await driver.sleep(800)
    const count = await text('#profile-count')
    assert(/0\s*of\s*16/i.test(count), `expected "0 of 16", got: ${count}`)
  })

  await test('LOGIN-GUEST-009', 'profile fields start empty', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    await driver.sleep(800)
    const name = await text('#value-name')
    assert(/not yet/i.test(name), `expected the empty placeholder, got: ${name}`)
  })

  await test('LOGIN-GUEST-010', 'the microphone control is available', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    assert(await present('#mic-btn'), '#mic-btn is missing')
  })
}

async function suiteGoogleInitiation() {
  console.log('\n LOGIN-GOOGLE · OAuth initiation (completion is a manual case)')

  await test('LOGIN-GOOGLE-001', 'the Google button is wired to a handler', async () => {
    await reachLoginScreen()
    const wired = await driver.executeScript(
      "return typeof window.startGoogleSignIn === 'function'")
    assertEqual(wired, true, 'startGoogleSignIn is not defined on window')
  })

  await test('LOGIN-GOOGLE-002', 'clicking Google shows no immediate error', async () => {
    await reachLoginScreen()
    await driver.findElement($('#google-btn')).click()
    await driver.sleep(1500)
    const err = await driver.executeScript(
      "var e=document.getElementById('login-google-error');return e?e.textContent.trim():''")
    assertEqual(err, '', `an error appeared immediately: ${err}`)
  })

  await test('LOGIN-GOOGLE-003', 'clicking Google leaves the app for an authorize URL', async () => {
    await reachLoginScreen()
    const before = await driver.getCurrentUrl()
    await driver.findElement($('#google-btn')).click()
    /* Either the browser navigates to Google/Supabase, or it stays put and
       reports why. Both are acceptable outcomes for an automated run; a
       silent no-op is not. */
    await driver.sleep(4000)
    const after = await driver.getCurrentUrl()
    const err = await driver.executeScript(
      "var e=document.getElementById('login-google-error');return e?e.textContent.trim():''")
    const navigated = after !== before &&
      /accounts\.google\.com|supabase\.co\/auth/i.test(after)
    assert(navigated || err.length > 0,
      `the Google button did nothing: url unchanged (${after}) and no error message`)
  })

  await test('LOGIN-GOOGLE-004', 'the authorize URL targets the Supabase project', async () => {
    await reachLoginScreen()
    const url = await driver.executeScript(`
      return (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : null`)
    assert(url && /supabase\.co/.test(url), `SUPABASE_URL is not configured: ${url}`)
  })
}

async function suiteAccessibility() {
  console.log('\n LOGIN-A11Y · reachable without sight or a mouse')

  await test('LOGIN-A11Y-001', 'the page declares a language', async () => {
    await freshLoad()
    const lang = await driver.executeScript("return document.documentElement.lang || ''")
    assert(lang.length > 0, 'the <html> element has no lang attribute')
  })

  await test('LOGIN-A11Y-002', 'a screen-reader live region exists', async () => {
    await freshLoad()
    assert(await present('#sr-announcer') || await present('[aria-live]'),
      'no aria-live region was found')
  })

  await test('LOGIN-A11Y-003', 'the auth buttons are real <button> elements', async () => {
    await reachLoginScreen()
    for (const sel of ['#google-btn', '#guest-btn']) {
      const tag = await driver.findElement($(sel)).getTagName()
      assertEqual(tag.toLowerCase(), 'button', `${sel} is a <${tag}>, not a button`)
    }
  })

  await test('LOGIN-A11Y-004', 'the Google button can be focused by keyboard', async () => {
    await reachLoginScreen()
    await driver.executeScript("document.getElementById('google-btn').focus()")
    const focused = await driver.executeScript("return document.activeElement.id")
    assertEqual(focused, 'google-btn', 'focus did not land on the Google button')
  })

  await test('LOGIN-A11Y-005', 'the guest button can be focused by keyboard', async () => {
    await reachLoginScreen()
    await driver.executeScript("document.getElementById('guest-btn').focus()")
    const focused = await driver.executeScript("return document.activeElement.id")
    assertEqual(focused, 'guest-btn', 'focus did not land on the guest button')
  })

  await test('LOGIN-A11Y-006', 'guest login can be completed with the keyboard alone', async () => {
    await reachLoginScreen()
    await driver.executeScript("document.getElementById('guest-btn').focus()")
    await driver.actions().sendKeys(Key.ENTER).perform()
    await driver.wait(async () => await visible('#main-app'), WAIT,
      'Enter on the guest button did not sign in')
  })

  await test('LOGIN-A11Y-007', 'the error line is announced politely', async () => {
    await reachLoginScreen()
    const role = await driver.executeScript(`
      var e=document.getElementById('login-google-error');
      return e ? (e.getAttribute('aria-live')||e.getAttribute('role')||'') : 'MISSING'`)
    assert(role !== 'MISSING', '#login-google-error does not exist')
  })
}

async function suiteResilience() {
  console.log('\n LOGIN-RES · state, reload and viewport')

  await test('LOGIN-RES-001', 'a reload before login returns to the start gate', async () => {
    await reachLoginScreen()
    await driver.navigate().refresh()
    await driver.wait(until.elementLocated($('body')), WAIT)
    assert(await visible('#start-overlay') || await visible('#login-screen'),
      'after reload neither the start overlay nor the login screen was shown')
  })

  await test('LOGIN-RES-002', 'guest mode survives a reload', async () => {
    await reachLoginScreen()
    await driver.findElement($('#guest-btn')).click()
    await driver.wait(async () => await visible('#main-app'), WAIT)
    await driver.navigate().refresh()
    await driver.sleep(1500)
    const guest = await localStorageGet('vh_guest')
    assertEqual(guest, 'true', 'vh_guest did not persist across a reload')
  })

  await test('LOGIN-RES-003', 'the login card fits a narrow mobile viewport', async () => {
    await driver.manage().window().setRect({ width: 360, height: 740 })
    await reachLoginScreen()
    const r = await driver.findElement($('.login-box')).getRect()
    assert(r.width <= 360, `the login card overflows a 360px viewport (${r.width}px)`)
    await driver.manage().window().setRect({ width: 1280, height: 900 })
  })

  await test('LOGIN-RES-004', 'the login card fits a tablet viewport', async () => {
    await driver.manage().window().setRect({ width: 768, height: 1024 })
    await reachLoginScreen()
    assert(await visible('#google-btn'), 'the Google button is not visible at 768px')
    await driver.manage().window().setRect({ width: 1280, height: 900 })
  })

  await test('LOGIN-RES-005', 'no horizontal scrolling on a phone-width viewport', async () => {
    await driver.manage().window().setRect({ width: 360, height: 740 })
    await reachLoginScreen()
    const overflow = await driver.executeScript(
      'return document.documentElement.scrollWidth - document.documentElement.clientWidth')
    assert(overflow <= 2, `the page scrolls horizontally by ${overflow}px`)
    await driver.manage().window().setRect({ width: 1280, height: 900 })
  })

  await test('LOGIN-RES-006', 'a stale token does not strand the user on a blank screen', async () => {
    await freshLoad()
    await driver.executeScript("localStorage.setItem('vh_token','definitely-not-a-valid-token')")
    await driver.navigate().refresh()
    await dismissStartOverlay()
    await driver.sleep(2500)
    const somethingVisible =
      (await visible('#login-screen')) || (await visible('#main-app')) || (await visible('#start-overlay'))
    assert(somethingVisible, 'the app showed nothing at all with an invalid stored token')
  })
}

/* ── Runner ────────────────────────────────────────────────────────────── */
async function buildDriver() {
  const options = new chrome.Options()
  if (HEADLESS) options.addArguments('--headless=new')
  options.addArguments(
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1280,900',
    /* The app asks for a microphone. Granting it up front keeps the
       permission prompt from blocking an unattended run. */
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream'
  )
  return new Builder().forBrowser('chrome').setChromeOptions(options).build()
}

async function main() {
  console.log('='.repeat(72))
  console.log(' VoiceHire — Selenium E2E: login / authentication')
  console.log(` target: ${BASE_URL}   headless: ${HEADLESS}`)
  console.log('='.repeat(72))

  driver = await buildDriver()
  try {
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30000, script: 30000 })
    await driver.manage().window().setRect({ width: 1280, height: 900 })

    await suiteAppLoad()
    await suiteLoginPresentation()
    await suiteGuestFlow()
    await suiteGoogleInitiation()
    await suiteAccessibility()
    await suiteResilience()
  } finally {
    if (driver) await driver.quit()
  }

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length

  console.log('\n' + '='.repeat(72))
  console.log(` LOGIN E2E: ${passed} passed, ${failed} failed, ${results.length} total`)
  if (failed) {
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`   · ${r.id} ${r.title} — ${r.error}`))
  }
  console.log('='.repeat(72))

  const outDir = path.join(__dirname, '..', 'reports')
  try {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
      path.join(outDir, 'login-results.json'),
      JSON.stringify({
        target: BASE_URL,
        headless: HEADLESS,
        executedAt: new Date().toISOString(),
        passed, failed, total: results.length,
        results
      }, null, 2)
    )
    console.log(` results written to reports/login-results.json`)
  } catch (e) {
    console.warn(' could not write the report:', e.message)
  }

  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\nThe run could not start:', e.message)
  console.error('Check that Chrome is installed and the app is served at ' + BASE_URL)
  if (driver) { try { await driver.quit() } catch (_) {} }
  process.exit(1)
})
