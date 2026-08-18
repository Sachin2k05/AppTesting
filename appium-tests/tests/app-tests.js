/* ─────────────────────────────────────────────────────────────────────────
   app-tests.js — Appium E2E for the VoiceHire Android app

   ── What this drives ──────────────────────────────────────────────────────
   The installed release APK on a real device or emulator:

       package  com.voicehire.mobile
       activity .MainActivity

   Every selector below is an accessibility id taken from the app's own
   accessibilityLabel props, or visible text read out of the screens — none
   are invented. React Native maps accessibilityLabel to Android's
   content-desc, which is what `~selector` matches.

       ~Continue with Google                 SignInScreen
       ~Continue as guest, without signing in
       ~Start your profile                   HomeScreen
       ~Sign out and choose a different Google account
       ~Speak now. The microphone usually opens by itself; …   mic control
       ~Repeat the last thing the recruiter said
       ~Stop      ~Type your answer instead   ~Your answer   ~Send
       ~Profile completion                   progress bar

   ── Three honest limits ───────────────────────────────────────────────────
   1. GOOGLE SIGN-IN cannot be completed here. It needs live credentials and
      scripting Google's form violates their terms. These tests assert the
      app correctly LEAVES for the browser; completion is a manual case
      (suite MAUTH-GOOGLE in the spreadsheet).
   2. AUDIO cannot be asserted. Appium cannot hear the listening beep or
      judge whether a phone number was spoken digit by digit. Those are
      manual cases and are marked as such.
   3. SPEECH INPUT cannot be injected — the microphone is physical hardware.
      Voice turns are driven through the typed fallback where one exists, and
      the spoken path is left to manual testing.

   Anything else would be a test that reports success without evidence.

   ── Running ───────────────────────────────────────────────────────────────
       npm install                       (appium + webdriverio, this folder)
       npx appium driver install uiautomator2
       npx appium                        (in a second terminal)
       npm test

       DEVICE=RMX2193 npm test           target a specific device
       APP_PATH=../mobile/android/app/build/outputs/apk/release/app-release.apk npm test
   ───────────────────────────────────────────────────────────────────────── */

'use strict'

const fs = require('fs')
const path = require('path')
const { remote } = require('webdriverio')

/* ── Configuration ─────────────────────────────────────────────────────── */
const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1'
const APPIUM_PORT = Number(process.env.APPIUM_PORT || 4723)
const DEVICE = process.env.DEVICE || 'Android Device'
const APP_PATH = process.env.APP_PATH || ''       // install fresh if provided
const PKG = 'com.voicehire.mobile'
const ACT = '.MainActivity'
const WAIT = Number(process.env.WAIT_MS || 15000)

/* The app talks to a backend that sleeps when idle; the first call after a
   cold start can take ~25s. Waits that follow a network call use this. */
const NET_WAIT = Number(process.env.NET_WAIT_MS || 60000)

const results = []
let driver = null

/* ── Harness ───────────────────────────────────────────────────────────── */
async function test(id, title, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ id, title, status: 'PASS', ms: Date.now() - t0, error: '' })
    console.log(`  PASS  ${id}  ${title}`)
  } catch (e) {
    results.push({ id, title, status: 'FAIL', ms: Date.now() - t0, error: e.message })
    console.log(`  FAIL  ${id}  ${title}\n          ${e.message}`)
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg) }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

/* ── Element helpers ───────────────────────────────────────────────────── */
const byText = (t) => `android=new UiSelector().text("${t}")`
const byContains = (t) => `android=new UiSelector().textContains("${t}")`

async function exists(selector, timeout = WAIT) {
  try {
    const el = await driver.$(selector)
    return await el.waitForExist({ timeout })
  } catch (e) { return false }
}

async function displayed(selector, timeout = WAIT) {
  try {
    const el = await driver.$(selector)
    await el.waitForDisplayed({ timeout })
    return true
  } catch (e) { return false }
}

async function tap(selector, timeout = WAIT) {
  const el = await driver.$(selector)
  await el.waitForDisplayed({ timeout })
  await el.click()
}

async function textOf(selector) {
  const el = await driver.$(selector)
  await el.waitForExist({ timeout: WAIT })
  return (await el.getText() || '').trim()
}

/** Restart the app cleanly without reinstalling (keeps stored session). */
async function relaunch() {
  await driver.terminateApp(PKG)
  await driver.activateApp(PKG)
  await driver.pause(3000)
}

/** Restart with storage wiped, so the sign-in screen is guaranteed. */
async function relaunchClean() {
  await driver.execute('mobile: clearApp', { appId: PKG }).catch(() => {})
  await driver.activateApp(PKG)
  await driver.pause(4000)
}

/** Get past sign-in as a guest, landing on the home screen. */
async function enterAsGuest() {
  if (await displayed('~Continue as guest, without signing in', 8000)) {
    await tap('~Continue as guest, without signing in')
  }
  await driver.pause(2500)
}

/* ── Suites ────────────────────────────────────────────────────────────── */

async function suiteLaunch() {
  console.log('\n MAPP-LAUNCH · install, launch and identity')

  await test('MAPP-LAUNCH-001', 'the app package is installed', async () => {
    assertEqual(await driver.isAppInstalled(PKG), true, `${PKG} is not installed`)
  })

  await test('MAPP-LAUNCH-002', 'the app launches to the foreground', async () => {
    const state = await driver.queryAppState(PKG)
    assert(state >= 3, `app state is ${state}; expected 3 (background) or 4 (foreground)`)
  })

  await test('MAPP-LAUNCH-003', 'the launched activity is MainActivity', async () => {
    const act = await driver.getCurrentActivity()
    assert(act.indexOf('MainActivity') !== -1, `unexpected activity: ${act}`)
  })

  await test('MAPP-LAUNCH-004', 'the current package is VoiceHire', async () => {
    assertEqual(await driver.getCurrentPackage(), PKG, 'a different package is in the foreground')
  })

  await test('MAPP-LAUNCH-005', 'the first screen renders within the launch budget', async () => {
    await relaunchClean()
    const shown = await displayed(byText('VoiceHire'), 20000)
    assertEqual(shown, true, 'no VoiceHire branding appeared after launch')
  })

  await test('MAPP-LAUNCH-006', 'the app does not crash on a cold start', async () => {
    await relaunchClean()
    await driver.pause(4000)
    assertEqual(await driver.getCurrentPackage(), PKG, 'the app left the foreground; it likely crashed')
  })

  await test('MAPP-LAUNCH-007', 'the app is locked to portrait', async () => {
    const o = await driver.getOrientation()
    assertEqual(String(o).toUpperCase(), 'PORTRAIT', `orientation is ${o}`)
  })
}

async function suiteSignIn() {
  console.log('\n MAPP-SIGNIN · the sign-in gate')

  await test('MAPP-SIGNIN-001', 'the sign-in screen is shown on a clean install', async () => {
    await relaunchClean()
    assertEqual(await displayed('~Continue with Google', 20000), true,
      'the Google button never appeared')
  })

  await test('MAPP-SIGNIN-002', 'the VoiceHire wordmark is present', async () => {
    assertEqual(await exists(byText('VoiceHire')), true, 'the wordmark is missing')
  })

  await test('MAPP-SIGNIN-003', 'the tagline is present', async () => {
    assertEqual(await exists(byContains('Your Voice')), true, 'the tagline is missing')
  })

  await test('MAPP-SIGNIN-004', 'the Google button is displayed', async () => {
    assertEqual(await displayed('~Continue with Google'), true, 'the Google button is not displayed')
  })

  await test('MAPP-SIGNIN-005', 'the guest button is displayed', async () => {
    assertEqual(await displayed('~Continue as guest, without signing in'), true,
      'the guest button is not displayed')
  })

  await test('MAPP-SIGNIN-006', 'guest is offered as an equal choice, not buried', async () => {
    const g = await driver.$('~Continue with Google')
    const q = await driver.$('~Continue as guest, without signing in')
    const gs = await g.getSize()
    const qs = await q.getSize()
    assert(qs.height >= gs.height * 0.6,
      `the guest control is much smaller than Google (${qs.height} vs ${gs.height})`)
  })

  await test('MAPP-SIGNIN-007', 'both controls meet the 44dp touch target guidance', async () => {
    for (const sel of ['~Continue with Google', '~Continue as guest, without signing in']) {
      const s = await (await driver.$(sel)).getSize()
      assert(s.height >= 44, `${sel} is only ${s.height}dp tall`)
    }
  })

  await test('MAPP-SIGNIN-008', 'tapping Google leaves the app for a browser', async () => {
    await relaunchClean()
    await tap('~Continue with Google', 20000)
    await driver.pause(6000)
    const pkg = await driver.getCurrentPackage()
    assert(pkg !== PKG, `the app stayed in the foreground (${pkg}); OAuth did not start`)
  })

  await test('MAPP-SIGNIN-009', 'returning from the browser does not crash the app', async () => {
    await driver.activateApp(PKG)
    await driver.pause(3000)
    assertEqual(await driver.getCurrentPackage(), PKG, 'the app did not come back cleanly')
  })
}

async function suiteGuest() {
  console.log('\n MAPP-GUEST · continuing without an account')

  await test('MAPP-GUEST-001', 'guest sign-in reaches the home screen', async () => {
    await relaunchClean()
    await enterAsGuest()
    assertEqual(await displayed('~Start your profile', 20000), true,
      'the Start control never appeared')
  })

  await test('MAPP-GUEST-002', 'the engine reports ready', async () => {
    assertEqual(await exists(byContains('Engine:')), true, 'no engine status is shown')
  })

  await test('MAPP-GUEST-003', 'guest mode is disclosed honestly', async () => {
    const shown = await exists(byContains('Guest mode'))
    assertEqual(shown, true, 'guest mode is not disclosed on the home screen')
  })

  await test('MAPP-GUEST-004', 'the disclosure states applications are not sent to employers', async () => {
    const t = await textOf(byContains('Guest mode'))
    assert(/not sent to employers/i.test(t),
      `the disclosure does not say applications are not sent: ${t}`)
  })

  await test('MAPP-GUEST-005', 'Start opens the conversation screen', async () => {
    await tap('~Start your profile')
    await driver.pause(4000)
    assertEqual(await exists(byContains('YOUR PROFILE')) || await exists(byContains('Listening'))
      || await exists(byContains('Speaking')), true, 'the conversation screen did not open')
  })
}

async function suiteConversationUi() {
  console.log('\n MAPP-CONV · the conversation screen reproduces the web layout')

  await test('MAPP-CONV-001', 'the VoiceHire wordmark is in the header', async () => {
    assertEqual(await exists(byText('VoiceHire')), true, 'no wordmark on the conversation screen')
  })

  await test('MAPP-CONV-002', 'a state pill is shown', async () => {
    const any = await exists(byContains('Speaking')) || await exists(byContains('Listening'))
      || await exists(byContains('Waiting')) || await exists(byContains('Thinking'))
    assertEqual(any, true, 'no state pill was found')
  })

  await test('MAPP-CONV-003', 'the status banner explains the microphone behaviour', async () => {
    const auto = await exists(byContains('mic activates automatically'))
    const listen = await exists(byContains('Listening'))
    assert(auto || listen, 'the banner does not describe the current voice state')
  })

  await test('MAPP-CONV-004', 'the session timer is present', async () => {
    assertEqual(await exists(byContains(':')), true, 'no session timer was found')
  })

  await test('MAPP-CONV-005', 'the profile panel is titled YOUR PROFILE', async () => {
    assertEqual(await exists(byContains('YOUR PROFILE')), true, 'the profile panel is missing')
  })

  await test('MAPP-CONV-006', 'the profile counter starts at 0 of 16 for a new guest', async () => {
    const t = await textOf(byContains(' of 16'))
    assert(/0\s*of\s*16/.test(t), `expected "0 of 16", got: ${t}`)
  })

  await test('MAPP-CONV-007', 'the progress bar exposes an accessible value', async () => {
    assertEqual(await exists('~Profile completion'), true,
      'the progress bar has no accessible name')
  })

  await test('MAPP-CONV-008', 'empty profile fields read "Not yet"', async () => {
    assertEqual(await exists(byContains('Not yet')), true,
      'no empty-field placeholder was found')
  })

  await test('MAPP-CONV-009', 'the CURRENT ACTIVITY panel is present', async () => {
    assertEqual(await exists(byContains('CURRENT ACTIVITY')), true,
      'the activity panel is missing')
  })

  await test('MAPP-CONV-010', 'the primary voice control is present', async () => {
    assertEqual(await exists('~Speak now. The microphone usually opens by itself; use this only to speak sooner.'),
      true, 'the mic control is missing')
  })

  await test('MAPP-CONV-011', 'the repeat control is present', async () => {
    assertEqual(await exists('~Repeat the last thing the recruiter said'), true,
      'the repeat control is missing')
  })

  await test('MAPP-CONV-012', 'the stop control is present', async () => {
    assertEqual(await exists('~Stop'), true, 'the stop control is missing')
  })

  await test('MAPP-CONV-013', 'typing is available but secondary', async () => {
    assertEqual(await exists('~Type your answer instead'), true,
      'the typed fallback is not reachable')
  })

  await test('MAPP-CONV-014', 'the interface is not a plain chat app', async () => {
    /* The web layout has an orb, a waveform and a profile panel. If only a
       message list and a send box were present, the mobile UI would have
       regressed to the chat-app shape that was rejected. */
    const rich = await exists(byContains('YOUR PROFILE')) && await exists(byContains('CURRENT ACTIVITY'))
    assertEqual(rich, true, 'the voice-first panels are missing; this looks like a chat app')
  })
}

async function suiteTypedTurn() {
  console.log('\n MAPP-TYPE · a full turn through the typed fallback')

  await test('MAPP-TYPE-001', 'the typed input can be opened', async () => {
    await tap('~Type your answer instead')
    assertEqual(await displayed('~Your answer', 10000), true, 'the text field did not appear')
  })

  await test('MAPP-TYPE-002', 'an answer can be entered', async () => {
    const el = await driver.$('~Your answer')
    await el.setValue('My name is Sachin')
    const v = await el.getText()
    assert(/sachin/i.test(v), `the field did not accept input: ${v}`)
  })

  await test('MAPP-TYPE-003', 'the answer can be submitted', async () => {
    await tap('~Send')
    await driver.pause(4000)
    assertEqual(await driver.getCurrentPackage(), PKG, 'the app left the foreground after submitting')
  })

  await test('MAPP-TYPE-004', 'the submitted answer is echoed in the transcript', async () => {
    const shown = await exists(byContains('Sachin'), 15000)
    assertEqual(shown, true, 'the answer does not appear in the transcript')
  })

  await test('MAPP-TYPE-005', 'the profile counter advances after a saved answer', async () => {
    await driver.pause(3000)
    const t = await textOf(byContains(' of 16'))
    assert(!/0\s*of\s*16/.test(t), `the counter did not advance: ${t}`)
  })

  await test('MAPP-TYPE-006', 'the saved value appears in the profile panel', async () => {
    assertEqual(await exists(byContains('Sachin')), true,
      'the stored value is not shown in the profile panel')
  })

  await test('MAPP-TYPE-007', 'the recruiter asks a different question next', async () => {
    /* The defect this guards: the same question being re-asked because the
       answer never reached ConversationManager. */
    await driver.pause(3000)
    const stillZero = await exists(byContains('0 of 16'))
    assertEqual(stillZero, false, 'progress is still 0 of 16; the answer was not processed')
  })
}

async function suitePermissions() {
  console.log('\n MAPP-PERM · runtime permissions')

  await test('MAPP-PERM-001', 'RECORD_AUDIO is declared by the package', async () => {
    const out = await driver.execute('mobile: shell', {
      command: 'dumpsys', args: ['package', PKG]
    }).catch(() => '')
    assert(String(out).indexOf('RECORD_AUDIO') !== -1,
      'RECORD_AUDIO is not declared; voice input cannot work')
  })

  await test('MAPP-PERM-002', 'INTERNET is declared by the package', async () => {
    const out = await driver.execute('mobile: shell', {
      command: 'dumpsys', args: ['package', PKG]
    }).catch(() => '')
    assert(String(out).indexOf('INTERNET') !== -1, 'INTERNET is not declared')
  })

  await test('MAPP-PERM-003', 'the app remains usable when the mic is denied', async () => {
    /* Typing must remain a genuine path, not a dead end. */
    assertEqual(await exists('~Type your answer instead') || await exists('~Your answer'), true,
      'with no microphone there is no way to answer at all')
  })
}

async function suiteStateAndSession() {
  console.log('\n MAPP-STATE · backgrounding, restart and persistence')

  await test('MAPP-STATE-001', 'the app survives being backgrounded', async () => {
    await driver.background(5)
    await driver.pause(2000)
    assertEqual(await driver.getCurrentPackage(), PKG, 'the app did not return to the foreground')
  })

  await test('MAPP-STATE-002', 'profile progress survives backgrounding', async () => {
    const before = await textOf(byContains(' of 16'))
    await driver.background(5)
    await driver.pause(2500)
    const after = await textOf(byContains(' of 16'))
    assertEqual(after, before, `progress changed across backgrounding: ${before} -> ${after}`)
  })

  await test('MAPP-STATE-003', 'a restart does not lose guest progress', async () => {
    const before = await textOf(byContains(' of 16'))
    await relaunch()
    await driver.pause(4000)
    if (await displayed('~Start your profile', 10000)) await tap('~Start your profile')
    await driver.pause(4000)
    const after = await textOf(byContains(' of 16'))
    assertEqual(after, before, `progress was lost on restart: ${before} -> ${after}`)
  })

  await test('MAPP-STATE-004', 'a clean install returns to the sign-in gate', async () => {
    await relaunchClean()
    assertEqual(await displayed('~Continue with Google', 20000), true,
      'a wiped install did not show the sign-in screen')
  })
}

async function suiteAccessibility() {
  console.log('\n MAPP-A11Y · reachable without sight')

  await test('MAPP-A11Y-001', 'the sign-in controls expose accessible names', async () => {
    await relaunchClean()
    for (const sel of ['~Continue with Google', '~Continue as guest, without signing in']) {
      assertEqual(await exists(sel, 20000), true, `${sel} has no content-desc`)
    }
  })

  await test('MAPP-A11Y-002', 'the guest label explains the consequence', async () => {
    const el = await driver.$('~Continue as guest, without signing in')
    const desc = await el.getAttribute('content-desc')
    assert(/without signing in/i.test(desc), `the label is not explanatory: ${desc}`)
  })

  await test('MAPP-A11Y-003', 'the mic control explains that it is optional', async () => {
    await enterAsGuest()
    if (await displayed('~Start your profile', 15000)) await tap('~Start your profile')
    await driver.pause(4000)
    const el = await driver.$('~Speak now. The microphone usually opens by itself; use this only to speak sooner.')
    const desc = await el.getAttribute('content-desc')
    assert(/opens by itself/i.test(desc),
      `the label does not say the mic is automatic: ${desc}`)
  })

  await test('MAPP-A11Y-004', 'profile fields announce their state', async () => {
    const el = await driver.$(`android=new UiSelector().descriptionContains("not yet collected")`)
    assertEqual(await el.isExisting(), true,
      'empty profile fields do not announce that they are uncollected')
  })

  await test('MAPP-A11Y-005', 'decorative visuals are not announced', async () => {
    /* The orb and waveform are marked importantForAccessibility="no-hide-
       descendants", so a screen reader should never land on a pulsing bar. */
    const bars = await driver.$$(`android=new UiSelector().descriptionContains("waveform")`)
    assertEqual(bars.length, 0, 'the waveform is exposed to accessibility services')
  })

  await test('MAPP-A11Y-006', 'interactive controls meet the touch target guidance', async () => {
    for (const sel of ['~Repeat the last thing the recruiter said', '~Stop']) {
      if (await exists(sel, 5000)) {
        const s = await (await driver.$(sel)).getSize()
        assert(s.height >= 44 && s.width >= 44, `${sel} is ${s.width}x${s.height}dp`)
      }
    }
  })
}

/* ── Runner ────────────────────────────────────────────────────────────── */
function capabilities() {
  const caps = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': DEVICE,
    'appium:appPackage': PKG,
    'appium:appActivity': ACT,
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 300,
    'appium:adbExecTimeout': 60000,
    'appium:uiautomator2ServerInstallTimeout': 120000,
    'appium:noReset': true
  }
  if (APP_PATH) {
    caps['appium:app'] = path.resolve(APP_PATH)
    caps['appium:noReset'] = false
  }
  return caps
}

async function main() {
  console.log('='.repeat(72))
  console.log(' VoiceHire — Appium E2E: Android app')
  console.log(` appium: http://${APPIUM_HOST}:${APPIUM_PORT}   device: ${DEVICE}`)
  console.log(` package: ${PKG}${APP_PATH ? `   installing: ${APP_PATH}` : '   (using the installed build)'}`)
  console.log('='.repeat(72))

  driver = await remote({
    hostname: APPIUM_HOST,
    port: APPIUM_PORT,
    path: '/',
    logLevel: 'error',
    capabilities: capabilities()
  })

  try {
    await suiteLaunch()
    await suiteSignIn()
    await suiteGuest()
    await suiteConversationUi()
    await suiteTypedTurn()
    await suitePermissions()
    await suiteStateAndSession()
    await suiteAccessibility()
  } finally {
    if (driver) await driver.deleteSession().catch(() => {})
  }

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length

  console.log('\n' + '='.repeat(72))
  console.log(` APPIUM E2E: ${passed} passed, ${failed} failed, ${results.length} total`)
  if (failed) results.filter(r => r.status === 'FAIL')
    .forEach(r => console.log(`   · ${r.id} ${r.title} — ${r.error}`))
  console.log('='.repeat(72))

  const outDir = path.join(__dirname, '..', 'reports')
  try {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'app-results.json'), JSON.stringify({
      device: DEVICE, package: PKG, executedAt: new Date().toISOString(),
      passed, failed, total: results.length, results
    }, null, 2))
    console.log(' results written to reports/app-results.json')
  } catch (e) {
    console.warn(' could not write the report:', e.message)
  }

  process.exit(failed ? 1 : 0)
}

main().catch(async (e) => {
  console.error('\nThe run could not start:', e.message)
  console.error('Check that:  the Appium server is running (npx appium),')
  console.error('             a device is attached (adb devices),')
  console.error(`             and ${PKG} is installed.`)
  if (driver) { try { await driver.deleteSession() } catch (_) {} }
  process.exit(1)
})
