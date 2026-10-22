import fs from 'node:fs'
const BASE = 'http://127.0.0.1:8791'
const info = await (await fetch(`${BASE}/api/app-info`)).json()
const configPayload = await (await fetch(`${BASE}/api/config`)).json()
const config = configPayload.config
config.platforms['快手'].packaging = { mode: 'unit', perUnit: 0.5, total: 0 }
const put = await fetch(`${BASE}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
console.log('PUT config:', put.status)

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 })
await page.waitForSelector('.kpi-row', { timeout: 120000 })
await page.waitForTimeout(1800)
const versionBadge = await page.locator('.badge--version').first().innerText()
const footer = await page.locator('.app-foot').innerText()
const packagedBadgeCount = await page.locator('.badge', { hasText: '打包版' }).count()
const dirText = await page.locator('.file-paths').first().innerText()
console.log('version badge:', versionBadge.trim())
console.log('footer contains version/data dir:', footer.includes('v1.2.0'), footer.includes('数据目录'))
console.log('packaged badge count:', packagedBadgeCount)
console.log('dir panel text sample:', dirText.split('\n').slice(0, 4).join(' | '))
const filesCard = page.locator('.subcard', { hasText: '数据文件' }).first()
await page.locator('.app-header').screenshot({ path: 'docs/screenshots/11-packaged-header.png' })
await filesCard.screenshot({ path: 'docs/screenshots/12-packaged-datadir.png' })
fs.writeFileSync('build/packaged-ui-check.json', JSON.stringify({ info, versionBadge, packagedBadgeCount, errors, footer: footer.slice(0, 300) }, null, 2))
console.log('console errors:', errors.length)
await browser.close()
