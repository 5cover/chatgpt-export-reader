import assert from 'node:assert/strict'
import { before, after, beforeEach, afterEach, test } from 'node:test'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { strToU8, zipSync } from 'fflate'
import { syntheticExport } from './fixtures.mjs'
const directory = fileURLToPath(new URL('..', import.meta.url))
const baseURL = 'http://127.0.0.1:4178'
let server, browser, context, page
let errors = []
before(async () => {
  const executablePath = process.env.BROWSER_PATH || '/usr/bin/chrome'
  await access(executablePath).catch(() => {
    throw new Error(
      `No browser at ${executablePath}. Set BROWSER_PATH to an installed Chromium. This command never downloads browsers.`
    )
  })
  let output = ''
  server = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      '--host',
      '127.0.0.1',
      '--port',
      '4178',
      '--strictPort',
    ],
    {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  server.stdout.on('data', data => {
    output += data
  })
  server.stderr.on('data', data => {
    output += data
  })
  let started = false
  for (let index = 0; index < 150; index++) {
    if (server.exitCode !== null) throw new Error(output)
    try {
      const response = await fetch(baseURL)
      if (response.ok) {
        started = true
        break
      }
    } catch {
      /* Wait for the local server. */
    }
    await delay(100)
  }
  if (!started) throw new Error(`Dashboard server did not start: ${output}`)
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
})
after(async () => {
  await browser?.close()
  server?.kill('SIGTERM')
})
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Paris' })
  page = await context.newPage()
  page.setDefaultTimeout(8000)
  errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(baseURL)
})
afterEach(async () => {
  await context?.close()
  assert.deepEqual(errors, [], 'No unhandled application errors')
})
async function importData(records = syntheticExport()) {
  const buffer = Buffer.from(zipSync({ 'conversations.json': strToU8(JSON.stringify(records)) }))
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'synthetic-export.zip', mimeType: 'application/zip', buffer })
  await page.locator('.summary-grid').first().waitFor()
  await page.getByRole('button', { name: 'Apply scope', exact: true }).waitFor()
}
async function navigate(name) {
  await page
    .getByRole('navigation', { name: 'Dashboard', exact: true })
    .getByRole('link', { name, exact: true })
    .click()
}
async function applyPeriod(start, end) {
  const controls = page.getByRole('form', { name: 'Analysis scope' })
  await controls.getByLabel('From', { exact: true }).fill(start)
  await controls.getByLabel('Through', { exact: true }).fill(end)
  await controls.getByRole('button', { name: 'Apply scope' }).click()
  await page.waitForFunction(
    ([start, end]) => document.querySelector('.applied-scope')?.textContent.includes(`${start} through ${end}`),
    [start, end]
  )
  await page.waitForFunction(() => !document.querySelector('.page-content')?.inert)
}
test(
  'period resets, comparisons, project scope, and recap inheritance use the same evidence',
  { timeout: 30000 },
  async () => {
    await importData()
    assert.equal(await page.locator('.summary-grid').first().locator('.metric').count(), 4)
    await applyPeriod('2026-02-01', '2026-02-28')
    assert.match(await page.locator('.comparison-note').innerText(), /2026-01-04 through 2026-01-31/)
    assert.match(await page.locator('.driver-note').innerText(), /active days/)
    const controls = page.getByRole('form', { name: 'Analysis scope' })
    await controls.getByRole('combobox', { name: 'Project', exact: true }).selectOption('id:project-writing')
    await controls.getByRole('button', { name: 'Apply scope' }).click()
    await page.waitForFunction(() => document.querySelector('.applied-scope')?.textContent.includes('project-writing'))
    await navigate('Recap')
    assert.match(await page.locator('.recap-settings').innerText(), /2026-02-01 through 2026-02-28/)
    assert.match(await page.locator('.recap-settings').innerText(), /project-writing/)
    await navigate('Overview')
    await controls.getByRole('button', { name: 'All time', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.scope-controls input[type=date]')?.value)
    assert.equal(await controls.getByLabel('Through', { exact: true }).inputValue(), '')
    assert.match(page.url(), /project=project-writing/)
  }
)
test(
  'search clears, content loads independently, disclosures collapse, and timeline reveals evidence',
  { timeout: 30000 },
  async () => {
    await importData()
    await page.evaluate(() => {
      location.hash = '#/conversations/chat-69'
    })
    const search = page.getByLabel('Search message text', { exact: true })
    await search.fill('not-a-real-phrase')
    await page.getByText('0 matching turns.', { exact: true }).waitFor()
    await search.fill('')
    await page.getByText('2 matching turns.', { exact: true }).waitFor()
    await page.locator('.message-trigger').evaluateAll(buttons => buttons.forEach(button => button.click()))
    await page.waitForFunction(() => document.querySelectorAll('.message-evidence pre').length === 2)
    await page.locator('.message-trigger').first().click()
    await page.locator('.message-evidence').first().locator('pre').waitFor({ state: 'detached' })
    await page.getByText('Message outline', { exact: true }).click()
    await page.getByRole('combobox', { name: 'Jump to turns', exact: true }).selectOption('1')
    await search.waitFor({ state: 'visible' })
    assert.equal(await search.inputValue(), '')
    await page.getByText('Investigate repeated language', { exact: true }).click()
    await page.getByRole('button', { name: 'Inspect occurrences', exact: true }).first().waitFor()
  }
)
test(
  'project naming is keyboard accessible, validated, reactive, and preserves valid saved entries',
  { timeout: 30000 },
  async () => {
    await page.evaluate(() =>
      localStorage.setItem(
        'chatgpt-export-reader/project-names/v1',
        JSON.stringify({ 'project-research': 'Research', invalid: 'x'.repeat(201) })
      )
    )
    await importData()
    await navigate('Projects')
    await page.getByText(/invalid saved names were ignored/).waitFor()
    await page.getByRole('link', { name: 'Research', exact: true }).click()
    const rename = page.getByRole('button', { name: 'Rename project Research', exact: true })
    await rename.focus()
    await page.keyboard.press('Enter')
    const input = page.getByLabel('Name for project project-research', { exact: true })
    assert.equal(await input.getAttribute('maxlength'), '200')
    await input.fill('Science')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Rename project Science', exact: true }).waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Rename project Science' })
        .evaluate(element => element === document.activeElement),
      true
    )
    await navigate('Overview')
    assert.equal(
      await page
        .getByRole('form', { name: 'Analysis scope' })
        .getByRole('combobox', { name: 'Project', exact: true })
        .locator('option:checked')
        .innerText(),
      'All projects'
    )
    assert.ok(await page.getByRole('link', { name: 'Science', exact: true }).count())
    await navigate('Projects')
    await page.getByRole('button', { name: 'Import names', exact: true }).focus()
    assert.equal(
      await page.getByRole('button', { name: 'Import names' }).evaluate(element => element === document.activeElement),
      true
    )
  }
)
test('module changes retain evidence and copy feedback tracks prompt changes', { timeout: 30000 }, async () => {
  await importData()
  await navigate('Recap')
  await page.getByRole('button', { name: 'Generate evidence' }).click()
  const download = page.getByRole('link', { name: /Download recap-context/ })
  await download.waitFor()
  const href = await download.getAttribute('href')
  await page.getByRole('checkbox', { name: 'Room portrait', exact: true }).check()
  assert.equal(await download.getAttribute('href'), href)
  assert.match(await page.locator('.recap-prompt').innerText(), /Room portrait/)
  await page.getByRole('checkbox', { name: 'Use a different evidence scope' }).check()
  await page.locator('.recap-settings').getByLabel('From', { exact: true }).fill('2026-02-01')
  await download.waitFor({ state: 'detached' })
})
test(
  'charts resize, retain zoom on measure changes, keep state when collapsed, and expose keyboard day selection',
  { timeout: 30000 },
  async () => {
    await importData()
    await page.getByLabel('Inspect day', { exact: true }).fill('2026-02-02')
    await page.getByRole('heading', { name: 'Conversations on 2026-02-02', exact: true }).waitFor()
    const initialViewport = await page.locator('output[aria-label="Chart viewport"]').innerText()
    const overlay = page.locator('.u-over').first()
    const box = await overlay.boundingBox()
    await page.mouse.move(box.x + box.width * 0.25, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + 60, { steps: 10 })
    await page.mouse.up()
    const ticks = await page.locator('output[aria-label="Chart viewport"]').innerText()
    assert.notEqual(ticks, initialViewport)
    await page.getByRole('radio', { name: 'Prompts', exact: true }).check()
    await delay(100)
    assert.equal(await page.locator('output[aria-label="Chart viewport"]').innerText(), ticks)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.chart')].every(
        element => element.querySelector('.uplot')?.getBoundingClientRect().width <= element.clientWidth + 1
      )
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await navigate('Time and rhythm')
    await page.getByText('Calendar rhythm', { exact: true }).click()
    await page.getByRole('button', { name: /2026-03-11:.*Inspect conversations/ }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
)
test(
  'tables bound rendered rows and session evidence preserves all contributing conversations',
  { timeout: 30000 },
  async () => {
    await importData()
    await navigate('Conversations')
    assert.equal(await page.locator('tbody tr').count(), 50)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    assert.equal(await page.locator('tbody tr').count(), 20)
    await navigate('Time and rhythm')
    await page.getByRole('table', { name: 'Sessions in scope', exact: true }).getByRole('link').first().click()
    await page.getByRole('heading', { name: 'Contributing conversations', exact: true }).waitFor()
    assert.ok(
      await page
        .locator('main')
        .getByRole('link', { name: /Research workflow/ })
        .count()
    )
  }
)
test('malformed routes recover and schema diagnostics are inspectable', { timeout: 30000 }, async () => {
  await page.goto(`${baseURL}/#/conversations/%`)
  await page.getByRole('heading', { name: 'Page not found' }).waitFor()
  await page.getByRole('link', { name: 'Return to Overview.' }).click()
  await importData([...syntheticExport(3), { unexpected: true }])
  await page.getByText('Import coverage and diagnostics', { exact: true }).click()
  assert.match(await page.locator('main').innerText(), /1 records could not be imported/)
  assert.match(await page.locator('main').innerText(), /record 4/)
})
