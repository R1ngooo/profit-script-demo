/**
 * 端到端验证脚本（无头 Edge）：截图 + 拖拽归类 + 人工输入持久化 + 溢出检查。
 * 运行前先 `npm run build && npm start`（服务端 8787）。
 */
import { mkdir } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const OUT = 'docs/screenshots'

const results = []
const fail = (message) => {
  results.push({ ok: false, message })
  console.error(`✗ ${message}`)
}
const pass = (message) => {
  results.push({ ok: true, message })
  console.log(`✓ ${message}`)
}

async function readMoney(locator) {
  const text = (await locator.innerText()).replace(/[^\d.-]/g, '')
  return Number(text)
}

async function apiJson(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

let originalConfig = null

async function backupConfig() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = await apiJson('/api/config').catch(() => null)
    const config = payload?.config
    if (config && config.version === 1 && config.platforms && typeof config.platforms === 'object') {
      originalConfig = config
      pass('已备份当前参数（测试结束后恢复）')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  fail('无法读取当前参数用于备份')
  throw new Error('配置备份失败')
}

async function restoreConfig() {
  if (!originalConfig) return
  const expectedSkus = Object.keys(originalConfig.customCosts ?? {}).length
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await apiJson('/api/config', { method: 'PUT', body: JSON.stringify(originalConfig) }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const current = await apiJson('/api/config').catch(() => null)
    const config = current?.config
    if (config && Object.keys(config.customCosts ?? {}).length === expectedSkus) {
      pass(`已恢复测试前参数（补录成本 ${expectedSkus} 条）`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  fail('测试后参数恢复失败，请检查 data/config.json（data/config.json.bak 为上一份）')
}

async function resetOverrides() {
  await apiJson('/api/status-pairs', { method: 'DELETE', body: '{}' })
}

const DEFAULT_FIELD_ORDER = [
  'settledSales',
  'refundSales',
  'refundRatio',
  'productCost',
  'productCostRatio',
  'grossProfit',
  'grossMargin',
  'settledQty',
  'packaging',
  'shipping',
  'shippingInsurance',
  'techFee',
  'commercialInsurance',
  'commission',
  'adSpend',
]

/** 把人工填写参数重置为默认值，确保每次运行从干净状态开始 */
async function resetParameterConfig() {
  const payload = await apiJson('/api/config').catch(() => null)
  const config = payload?.config
  if (!config) return
  const zeroFee = () => ({ mode: 'unit', perUnit: 0, total: 0 })
  config.customCosts = {}
  config.filters = { excludeTestOrders: true, includeAdPlatformsWithoutOrders: false }
  for (const name of Object.keys(config.platforms ?? {})) {
    config.platforms[name] = {
      packaging: zeroFee(),
      shipping: zeroFee(),
      insurance: zeroFee(),
      techFeeRate: 0,
      commercialInsuranceRate: 0,
    }
  }
  config.tableFieldOrder = [...DEFAULT_FIELD_ORDER]
  await apiJson('/api/config', { method: 'PUT', body: JSON.stringify(config) }).catch(() => undefined)
}

await mkdir(OUT, { recursive: true })
await backupConfig()
await resetOverrides()
await resetParameterConfig()

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 })
  await page.waitForSelector('.kpi-row', { timeout: 120000 })
  await page.waitForTimeout(1600)

  const overflowWide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflowWide <= 1) pass('1440 宽无横向溢出')
  else fail(`1440 宽存在横向溢出 ${overflowWide}px`)

  // 版本号与运行目录（打包版信息由 /api/app-info 提供）
  try {
    await page.waitForSelector('.badge--version', { timeout: 15000 })
  } catch {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.kpi-row', { timeout: 120000 })
    await page.waitForTimeout(1200)
    await page.waitForSelector('.badge--version', { timeout: 30000 })
  }
  const appInfo = await apiJson('/api/app-info')
  if (appInfo?.version === '1.2.0' && appInfo?.home && appInfo?.dataDir) {
    pass(`应用信息：v${appInfo.version}，数据目录 ${appInfo.dataDir}`)
  } else {
    fail(`应用信息异常：${JSON.stringify(appInfo)}`)
  }
  const versionBadgeText = await page.locator('.badge--version').first().innerText()
  if (versionBadgeText.includes('v1.2.0')) pass(`页头版本号：${versionBadgeText.trim()}`)
  else fail(`页头版本号异常：${versionBadgeText}`)
  const footerText = await page.locator('.app-foot').innerText()
  if (footerText.includes('v1.2.0') && footerText.includes('数据目录')) pass('页脚显示版本与数据目录')
  else fail('页脚缺少版本/数据目录信息')

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/01-overview-light.png`, fullPage: true })
  pass('已截图 01-overview-light.png')

  const kpiText = await page.locator('.kpi-row').innerText()
  if (kpiText.includes('预估结算金额') && kpiText.includes('粗算毛利')) pass('KPI 正常渲染')
  else fail('KPI 未渲染')

  // ---- 新平台 + 达人佣金 ----
  const summaryApi = await apiJson('/api/summary')
  if (summaryApi?.platforms?.length === 7) pass('七个平台均已加载（快手/视频号/抖音/天猫/拼多多/京东/小红书）')
  else fail(`平台数量异常：${summaryApi?.platforms?.length}`)
  if ((summaryApi?.commission?.matchedAmount ?? 0) > 0) {
    pass(
      `达人佣金自动匹配：计入毛利 ¥${summaryApi.commission.matchedAmount.toFixed(2)}（${summaryApi.commission.matchedRecords} 条）`,
    )
  } else {
    fail('达人佣金未匹配到任何记录')
  }
  if ((summaryApi?.commission?.matchedRecords ?? 0) >= 5000) pass('抖音订单级达人佣金匹配生效')
  else fail(`抖音佣金匹配条数偏少：${summaryApi?.commission?.matchedRecords}`)
  if ((summaryApi?.warnings ?? []).every((warning) => !warning.includes('有广告消耗但没有订单源'))) {
    pass('新平台订单源已覆盖广告平台')
  } else {
    fail('仍有广告平台缺少订单源')
  }
  const commissionCard = page.locator('.subcard', { hasText: '商务订单 · 达人佣金' })
  if (await commissionCard.count()) pass('面板 Ⅲ 达人佣金卡片渲染')
  else fail('缺少达人佣金卡片')

  // ---- ① 毛利板块新增比率字段 ----
  const headerFields = await page
    .locator('.pnl-table thead th')
    .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').trim()))
  if (headerFields.some((text) => text.includes('产品成本费比')) && headerFields.some((text) => text.includes('退款比例'))) {
    pass('毛利表新增「产品成本费比 / 退款比例」列')
  } else {
    fail(`毛利表缺少新增列：${headerFields.join(' | ')}`)
  }
  const kuaishouPnl = summaryApi.platforms.find((pnl) => pnl.platform === '快手')
  const ksCostRatio = `${((kuaishouPnl.productCost / kuaishouPnl.settledSales) * 100).toFixed(2)}%`
  const ksRefundRatio = `${((kuaishouPnl.refundSales / (kuaishouPnl.settledSales + kuaishouPnl.refundSales)) * 100).toFixed(2)}%`
  const kuaishouRowText = await page.locator('.pnl-table tbody tr', { hasText: '快手' }).first().innerText()
  if (kuaishouRowText.includes(ksCostRatio) && kuaishouRowText.includes(ksRefundRatio)) {
    pass(`快手行比率正确：产品成本费比 ${ksCostRatio} / 退款比例 ${ksRefundRatio}`)
  } else {
    fail(`快手行比率异常（期望 ${ksCostRatio} / ${ksRefundRatio}）：${kuaishouRowText.replace(/\n/g, ' | ')}`)
  }

  // ---- 历史数据目录忽略 + 新导入数据源 ----
  const datasetPaths = (summaryApi.dataset ?? []).map((file) => file.path ?? '')
  if (datasetPaths.length && datasetPaths.every((filePath) => !filePath.includes('历史数据'))) {
    pass('解析文件列表不含「历史数据」目录')
  } else {
    fail(`历史数据目录文件混入解析：${datasetPaths.filter((filePath) => filePath.includes('历史数据')).join(' | ')}`)
  }
  if ((summaryApi.warnings ?? []).some((warning) => warning.includes('已忽略「历史数据」文件夹'))) {
    pass('面板提示已忽略「历史数据」文件夹')
  } else {
    fail('缺少「历史数据」忽略提示')
  }

  // ---- ② 毛利板块自定义字段排序 ----
  const readFieldOrder = () =>
    page
      .locator('.pnl-table thead th[data-field]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-field')))
  const orderBefore = await readFieldOrder()
  await page.getByRole('button', { name: '字段排序' }).click()
  const grossProfitItem = page.locator('.popover__list li[data-field="grossProfit"]')
  if (await grossProfitItem.count()) {
    await grossProfitItem.locator('button[aria-label*="上移"]').click()
    await page.waitForTimeout(1000)
    const orderAfter = await readFieldOrder()
    const fromIndex = orderBefore.indexOf('grossProfit')
    const toIndex = orderAfter.indexOf('grossProfit')
    if (toIndex === fromIndex - 1) pass(`字段上移生效：粗算毛利 第 ${fromIndex + 1} 列 → 第 ${toIndex + 1} 列`)
    else fail(`字段上移未生效：${fromIndex} → ${toIndex}`)
    const savedConfig = await apiJson('/api/config')
    if (savedConfig?.config?.tableFieldOrder?.[toIndex] === 'grossProfit') pass('字段顺序已写入配置')
    else fail('字段顺序未写入配置')

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.pnl-table', { timeout: 60000 })
    await page.waitForTimeout(1000)
    const orderReloaded = await readFieldOrder()
    if (orderReloaded.indexOf('grossProfit') === toIndex) pass('刷新后字段顺序保持')
    else fail('刷新后字段顺序丢失')

    await page.getByRole('button', { name: '字段排序' }).click()
    await page.locator('.popover__foot button', { hasText: '重置默认' }).click()
    await page.waitForTimeout(900)
    const orderReset = await readFieldOrder()
    if (orderReset[0] === 'settledSales' && orderReset[4] === 'productCostRatio' && orderReset[5] === 'grossProfit') {
      pass('字段顺序重置为默认')
    } else {
      fail(`字段顺序重置异常：${orderReset.slice(0, 6).join(',')}`)
    }
    await page.getByRole('button', { name: '字段排序' }).click()
  } else {
    fail('未找到字段排序面板')
  }

  // 抖音平台状态判定截图
  await page.locator('.platform-tab', { hasText: '抖音' }).click()
  await page.waitForTimeout(500)
  await page.locator('.section-card').first().screenshot({ path: `${OUT}/05-status-board-douyin.png` })
  pass('已截图 05-status-board-douyin.png')

  // ---- 面板 Ⅰ：拖拽归类（用较高视口避免滚动导致坐标漂移） ----
  await page.setViewportSize({ width: 1440, height: 1700 })
  await page.waitForTimeout(500)
  await page.locator('.platform-tab', { hasText: '视频号' }).click()
  await page.waitForTimeout(400)

  const chip = page.locator('.column--refund .chip', { hasText: '已完成' }).filter({ hasText: '退款完成' }).first()
  if (!(await chip.count())) {
    fail('未找到「已完成 → 退款完成」退款卡片')
  } else {
    await chip.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const chipSales = await readMoney(chip.locator('.chip__sales'))
    const settleBefore = await readMoney(page.locator('.column--settle .column__totals strong'))

    const waitForManual = async () =>
      page.waitForFunction(
        () =>
          [...document.querySelectorAll('.column--settle .chip')].some(
            (element) => element.textContent.includes('退款完成') && element.textContent.includes('手动'),
          ),
        undefined,
        { timeout: 8000 },
      )

    await chip.dragTo(page.locator('.column--settle'))
    try {
      await waitForManual()
    } catch {
      // 拖拽偶发未生效时重试一次
      await chip.dragTo(page.locator('.column--settle'))
      await waitForManual()
    }
    await page.waitForTimeout(600)

    const settleAfter = await readMoney(page.locator('.column--settle .column__totals strong'))
    const delta = Math.round((settleAfter - settleBefore) * 100) / 100
    if (Math.abs(delta - chipSales) < 0.02) pass(`拖拽归类生效：结算额增加 ${delta}（卡片 ${chipSales}）`)
    else fail(`拖拽归类金额不符：结算额增加 ${delta}，卡片 ${chipSales}`)

    const moved = await page.locator('.column--settle .chip', { hasText: '已完成' }).filter({ hasText: '退款完成' }).first()
    if ((await moved.innerText()).includes('手动')) pass('归类卡片显示「手动」徽章')
    else fail('归类卡片未显示手动徽章')

    await page.locator('.section-card').first().screenshot({ path: `${OUT}/02-status-board.png` })
    pass('已截图 02-status-board.png')

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.kpi-row', { timeout: 60000 })
    await page.waitForTimeout(1200)
    await page.locator('.platform-tab', { hasText: '视频号' }).click()
    const persisted = await page.locator('.column--settle .chip', { hasText: '已完成' }).filter({ hasText: '退款完成' }).first()
    if ((await persisted.innerText()).includes('手动')) pass('刷新后人工归类已持久化')
    else fail('刷新后人工归类丢失')

    await page.locator('.btn--soft', { hasText: '恢复自动判定' }).click()
    await page.waitForTimeout(1400)
    const afterReset = await apiJson('/api/config')
    if (Object.keys(afterReset?.config?.statusOverrides ?? {}).length === 0) pass('恢复自动判定后覆盖已清空')
    else fail('恢复自动判定未清空覆盖')
  }

  // ---- 面板 Ⅲ：草稿预览 → 提交保存 / 撤销修改 / 恢复默认 ----
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(400)

  const parameterActions = page.locator('.parameter-actions')
  if (await parameterActions.count()) pass('面板 Ⅲ 顶部渲染提交/保存操作按钮')
  else fail('缺少提交/保存操作按钮')

  const configBefore = await apiJson('/api/config')
  const beforeKuaishou = configBefore?.config?.platforms?.['快手']
  if (
    beforeKuaishou?.packaging?.mode === 'unit' &&
    Math.abs(beforeKuaishou.packaging.perUnit) < 1e-9 &&
    Math.abs(beforeKuaishou.shipping.perUnit) < 1e-9 &&
    Math.abs(beforeKuaishou.insurance.perUnit) < 1e-9
  ) {
    pass('初始快手三项费用为 0（按件模式）')
  } else {
    fail(`初始快手费用异常：${JSON.stringify(beforeKuaishou)}`)
  }

  // 计费口径说明：“件”= 结算商品数量
  const basisText = await page.locator('.subcard', { hasText: '计费口径' }).first().innerText()
  if (basisText.includes('「件」= 结算商品数量') && basisText.includes('商品数量')) {
    pass('面板 Ⅲ 明确「件」= 结算商品数量')
  } else {
    fail(`计费口径说明缺失：${basisText.slice(0, 100)}`)
  }
  const modeSelectCount = await page.locator('.rate-row .fee-mode').count()
  if (modeSelectCount === 21) pass('每平台 × 包装费/运费/运费险共 21 个算法下拉')
  else fail(`算法下拉数量异常：${modeSelectCount}`)
  await page.locator('.subcard.basis').screenshot({ path: `${OUT}/09-fee-basis.png` })
  pass('已截图 09-fee-basis.png')

  const grossValueLocator = page.locator('.kpi-row .kpi__value').nth(1)
  const readGross = async () => Number((await grossValueLocator.innerText()).replace(/[^\d.-]/g, ''))
  const waitForPreviewDone = async () => {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.parameter-actions .param-status')
        return el && !el.textContent.includes('预览计算中') && !el.textContent.includes('保存中')
      },
      undefined,
      { timeout: 25000 },
    )
  }
  const waitForGross = async (expected, tolerance = 1) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await readGross()
      if (Math.abs(value - expected) <= tolerance) return value
      await page.waitForTimeout(200)
    }
    return readGross()
  }
  const feeRow = (platform, item) =>
    page.locator(`.rate-row[data-platform="${platform}"] [data-item="${item}"]`)
  const feeInput = (platform, item, field) => feeRow(platform, item).locator(`[data-field="${item}-${field}"] input`)
  const feeMode = (platform, item) => feeRow(platform, item).locator('.fee-mode')
  const waitForSaved = async () => {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.parameter-actions .param-status')
        return el && el.textContent.includes('已保存')
      },
      undefined,
      { timeout: 45000 },
    )
    await page.waitForTimeout(400)
  }

  const summaryBefore = await apiJson('/api/summary')
  const kuaishouQty = summaryBefore?.platforms?.find((pnl) => pnl.platform === '快手')?.settledQty ?? 0
  const grossBefore = await readGross()

  // ---- 按件模式：0.5 元/件 × 快手结算件数 ----
  const ksPackagingUnit = feeInput('快手', 'packaging', 'per-unit')
  await ksPackagingUnit.scrollIntoViewIfNeeded()
  await ksPackagingUnit.fill('0.5')
  await ksPackagingUnit.press('Enter')
  await waitForPreviewDone()
  await page.waitForTimeout(400)

  const draftConfig = await apiJson('/api/config')
  if (Math.abs(draftConfig?.config?.platforms?.['快手']?.packaging?.perUnit ?? 0) < 1e-9) {
    pass('填写后只生成草稿，未自动写入配置')
  } else {
    fail('填写后被自动保存（不符合显式提交预期）')
  }
  const dirtyStatusText = await page.locator('.parameter-actions .param-status').innerText()
  if (dirtyStatusText.includes('未保存')) pass(`顶部状态提示未保存：${dirtyStatusText.trim()}`)
  else fail(`顶部状态未提示未保存：${dirtyStatusText}`)
  if (await page.locator('.pending-bar').count()) pass('底部悬浮「未保存」操作条出现')
  else fail('底部悬浮操作条未出现')

  await page.locator('.section-card').nth(2).locator('.section-head').screenshot({ path: `${OUT}/07-parameter-actions.png` })
  pass('已截图 07-parameter-actions.png')

  const unitRowText = await feeRow('快手', 'packaging').innerText()
  const expectedUnitText = (0.5 * kuaishouQty).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (unitRowText.includes(expectedUnitText)) {
    pass(`快手包装费按件合计 = 0.5 × ${kuaishouQty} 件 = ¥${expectedUnitText}`)
  } else {
    fail(`按件合计显示异常（期望 ¥${expectedUnitText}）：${unitRowText.replace(/\n/g, ' | ')}`)
  }

  const expectedUnitDelta = 0.5 * kuaishouQty
  const grossUnit = await waitForGross(grossBefore - expectedUnitDelta)
  if (Math.abs(grossBefore - grossUnit - expectedUnitDelta) < 1) {
    pass(`按件算法预览生效：毛利减少 ${(grossBefore - grossUnit).toFixed(2)}（期望 ${expectedUnitDelta.toFixed(2)}）`)
  } else {
    fail(`按件预览异常：毛利变化 ${(grossBefore - grossUnit).toFixed(2)}，期望 ${expectedUnitDelta.toFixed(2)}`)
  }

  await page.locator('.parameter-actions').getByRole('button', { name: '撤销修改' }).click()
  const grossReverted = await waitForGross(grossBefore)
  if (Math.abs(grossReverted - grossBefore) < 1) pass('撤销修改后毛利恢复')
  else fail(`撤销后毛利未恢复：${grossReverted} vs ${grossBefore}`)
  if (!(await page.locator('.pending-bar').count())) pass('撤销后未保存提示消失')
  else fail('撤销后未保存提示仍存在')

  // ---- 按总额模式：直接填写总额，与件数无关（各平台独立） ----
  await feeMode('快手', 'packaging').selectOption('total')
  await waitForPreviewDone()
  const ksPackagingTotal = feeInput('快手', 'packaging', 'total')
  await ksPackagingTotal.fill('1234.56')
  await ksPackagingTotal.press('Enter')
  await waitForPreviewDone()
  const videoPackagingText = await feeRow('视频号', 'packaging').innerText()
  if (videoPackagingText.includes('0.00')) pass('各平台独立：视频号包装费仍为 0')
  else fail(`视频号包装费被联动：${videoPackagingText.replace(/\n/g, ' | ')}`)

  const grossTotalMode = await waitForGross(grossBefore - 1234.56)
  if (Math.abs(grossBefore - grossTotalMode - 1234.56) < 1) pass('按总额算法：毛利直接减少 ¥1,234.56（与件数无关）')
  else fail(`按总额预览异常：毛利变化 ${(grossBefore - grossTotalMode).toFixed(2)}，期望 1234.56`)

  await page.locator('.parameter-actions').getByRole('button', { name: '提交并保存' }).click()
  await waitForSaved()
  const submittedConfig = await apiJson('/api/config')
  const savedKs = submittedConfig?.config?.platforms?.['快手']
  if (savedKs?.packaging?.mode === 'total' && Math.abs(savedKs.packaging.total - 1234.56) < 1e-9) {
    pass('提交并保存后快手包装费为「按总额 1234.56」')
  } else {
    fail(`提交后快手包装费异常：${JSON.stringify(savedKs?.packaging)}`)
  }
  const submittedSummary = await apiJson('/api/summary')
  if (Math.abs((submittedSummary?.totals?.packaging ?? 0) - 1234.56) < 0.02) {
    pass('保存后包装费合计 = ¥1,234.56')
  } else {
    fail(`保存后包装费合计异常：${submittedSummary?.totals?.packaging}`)
  }

  // ---- 第二个平台独立设置：视频号运费险按总额 88 ----
  await feeMode('视频号', 'insurance').selectOption('total')
  await waitForPreviewDone()
  const vsInsuranceTotal = feeInput('视频号', 'insurance', 'total')
  await vsInsuranceTotal.fill('88')
  await vsInsuranceTotal.press('Enter')
  await waitForPreviewDone()
  await page.locator('.parameter-actions').getByRole('button', { name: '提交并保存' }).click()
  await waitForSaved()
  const mixedConfig = await apiJson('/api/config')
  const mixedSummary = await apiJson('/api/summary')
  if (
    Math.abs((mixedConfig?.config?.platforms?.['视频号']?.insurance?.total ?? 0) - 88) < 1e-9 &&
    Math.abs((mixedConfig?.config?.platforms?.['快手']?.packaging?.total ?? 0) - 1234.56) < 1e-9
  ) {
    pass('各平台独立保存：视频号运费险按总额 88、快手包装费按总额 1234.56')
  } else {
    fail('多平台独立保存异常')
  }
  if (Math.abs((mixedSummary?.totals?.shippingInsurance ?? 0) - 88) < 0.02) pass('运费险合计 = ¥88（总额模式）')
  else fail(`运费险合计异常：${mixedSummary?.totals?.shippingInsurance}`)

  await page.addStyleTag({ content: '.app-header{position:static !important}' })
  await page.waitForTimeout(3800)
  await page.locator('.subcard.rate-form').screenshot({ path: `${OUT}/08-platform-fees.png` })
  pass('已截图 08-platform-fees.png')

  // ---- Ctrl+S 快捷键提交（快手运费改回按件 1.1 元/件） ----
  await feeMode('快手', 'shipping').selectOption('unit')
  await waitForPreviewDone()
  const ksShippingUnit = feeInput('快手', 'shipping', 'per-unit')
  await ksShippingUnit.fill('1.1')
  await ksShippingUnit.press('Enter')
  await waitForPreviewDone()
  await page.keyboard.press('Control+s')
  await waitForSaved()
  const shortcutSaved = await apiJson('/api/config')
  const savedShipping = shortcutSaved?.config?.platforms?.['快手']?.shipping
  if (savedShipping?.mode === 'unit' && Math.abs(savedShipping.perUnit - 1.1) < 1e-9) {
    pass('Ctrl+S 快捷键提交并保存生效（快手运费按件 1.1 元/件）')
  } else {
    fail(`Ctrl+S 未保存：${JSON.stringify(savedShipping)}`)
  }

  // ---- 恢复默认并提交 ----
  await page.locator('.parameter-actions').getByRole('button', { name: '恢复默认参数' }).click()
  await page.locator('.parameter-actions').getByRole('button', { name: '确认恢复' }).click()
  await waitForPreviewDone()
  const resetStatusText = await page.locator('.parameter-actions .param-status').innerText()
  if (resetStatusText.includes('未保存')) pass('恢复默认参数以草稿形式生效并提示未保存')
  else fail(`恢复默认后状态异常：${resetStatusText}`)
  await page.locator('.parameter-actions').getByRole('button', { name: '提交并保存' }).click()
  await waitForSaved()
  const restored = await apiJson('/api/config')
  const restoredKs = restored?.config?.platforms?.['快手']
  const restoredFee = restoredKs?.packaging
  if (
    restoredFee?.mode === 'unit' &&
    Math.abs(restoredFee.perUnit) < 1e-9 &&
    Math.abs(restoredFee.total) < 1e-9 &&
    Math.abs(restored?.config?.platforms?.['视频号']?.insurance?.total ?? 0) < 1e-9
  ) {
    pass('恢复默认并提交后所有费用归零')
  } else {
    fail(`恢复默认后费用未归零：${JSON.stringify(restoredKs?.packaging)}`)
  }

  const restoredSummary = await apiJson('/api/summary')
  if (
    Math.abs(restoredSummary?.totals?.packaging ?? 0) < 0.02 &&
    Math.abs(restoredSummary?.totals?.shipping ?? 0) < 0.02 &&
    Math.abs(restoredSummary?.totals?.shippingInsurance ?? 0) < 0.02
  ) {
    pass('保存后包装费/运费/运费险合计均为 0')
  } else {
    fail('恢复默认后费用合计不为 0')
  }

  // ---- ③ 面板 Ⅲ：计费口径与分平台费率上下排列 ----
  const unitCardBox = await page.locator('.subcard.basis').first().boundingBox()
  const rateCardBox = await page.locator('.subcard.rate-form').first().boundingBox()
  if (
    unitCardBox &&
    rateCardBox &&
    Math.abs(unitCardBox.x - rateCardBox.x) <= 2 &&
    Math.abs(unitCardBox.width - rateCardBox.width) <= 2 &&
    rateCardBox.y >= unitCardBox.y + unitCardBox.height - 2
  ) {
    pass('面板 Ⅲ 计费口径与分平台费率上下排列')
  } else {
    fail(`面板 Ⅲ 布局异常：basis=${JSON.stringify(unitCardBox)} rate=${JSON.stringify(rateCardBox)}`)
  }
  await page.waitForTimeout(3800)
  await page.locator('.inputs-stack').screenshot({ path: `${OUT}/06-panel3-layout.png` })
  pass('已截图 06-panel3-layout.png（计费口径 + 分平台费率上下结构）')

  // ---- 缺失成本 Excel 批量补录 ----
  const missingBefore = await apiJson('/api/summary')
  const missingList = (missingBefore?.missingCosts ?? []).filter((item) => item.sku)
  if (missingList.length >= 2) pass(`当前缺失 ${missingBefore.missingCosts.length} 个 SKU，取前两个做批量补录`)
  else fail('缺失成本样本不足，无法测试批量补录')

  const templateRes = await fetch(`${BASE}/api/costs/template.xlsx`)
  const templateBuffer = Buffer.from(await templateRes.arrayBuffer())
  const templateWb = new ExcelJS.Workbook()
  await templateWb.xlsx.load(templateBuffer)
  const templateSheet = templateWb.getWorksheet('成本补录')
  const templateHeader = (templateSheet?.getRow(1).values ?? []).slice(1)
  if (
    templateRes.ok &&
    templateHeader[1] === '商品编码' &&
    /成本|单价|月/.test(String(templateHeader[3] ?? '')) &&
    templateSheet.rowCount === missingBefore.missingCosts.length + 1
  ) {
    pass(`补录模板可下载：关键列 ${templateHeader.slice(0, 4).join('/')}，含 ${templateSheet.rowCount - 1} 个缺失 SKU`)
  } else {
    fail(`补录模板异常：${JSON.stringify(templateHeader)} 行数=${templateSheet?.rowCount}`)
  }

  const importTargets = missingList.slice(0, 2)
  const importCosts = [1.23, 4.56]
  const expectedCostDelta = importTargets.reduce((sum, item, index) => sum + importCosts[index] * item.settledQty, 0)
  const grossBeforeImport = await readGross()

  const uploadWb = new ExcelJS.Workbook()
  const uploadSheet = uploadWb.addWorksheet('成本补录')
  uploadSheet.addRow(['商品编码', '商品名', '成本价', '备注'])
  importTargets.forEach((item, index) => uploadSheet.addRow([item.sku, item.productName, importCosts[index], '可忽略备注']))
  uploadSheet.addRow(['NOT-EXIST-SKU', '不存在的商品', 9.9, '应被忽略'])
  const uploadBuffer = Buffer.from(await uploadWb.xlsx.writeBuffer())

  await page.locator('#missing-costs').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.locator('#cost-import-input').setInputFiles({
    name: '成本批量补录.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: uploadBuffer,
  })
  await page.waitForSelector('.missing__import', { timeout: 30000 })
  await waitForPreviewDone()
  await page.waitForTimeout(600)

  const importText = await page.locator('.missing__import').first().innerText()
  if (importText.includes('已导入 2 个 SKU 成本')) pass('Excel 批量补录成功导入 2 个 SKU')
  else fail(`导入结果异常：${importText.replace(/\n/g, ' | ')}`)
  if (importText.includes('未知 SKU 1')) pass('上传表中的未知 SKU 行被忽略并提示')
  else fail(`未知 SKU 提示缺失：${importText.replace(/\n/g, ' | ')}`)
  if (importText.includes('草稿未保存')) pass('批量补录进入草稿（未保存）状态') 
  else fail('批量补录未提示草稿状态')

  for (const target of importTargets) {
    const remainingRows = await page.locator('.missing__table tbody tr').filter({ hasText: target.sku }).count()
    if (remainingRows === 0) pass(`补录后 ${target.sku} 已从缺失列表消失`)
    else fail(`补录后 ${target.sku} 仍在缺失列表`)
  }
  const grossAfterImport = await waitForGross(grossBeforeImport - expectedCostDelta)
  if (Math.abs(grossBeforeImport - grossAfterImport - expectedCostDelta) < 1) {
    pass(`批量补录预览生效：毛利减少 ${(grossBeforeImport - grossAfterImport).toFixed(2)}（期望 ${expectedCostDelta.toFixed(2)}）`)
  } else {
    fail(`批量补录预览异常：毛利变化 ${(grossBeforeImport - grossAfterImport).toFixed(2)}，期望 ${expectedCostDelta.toFixed(2)}`)
  }

  await page.waitForTimeout(3800)
  await page.locator('#missing-costs').screenshot({ path: `${OUT}/10-cost-import.png` })
  pass('已截图 10-cost-import.png')

  await page.locator('.parameter-actions').getByRole('button', { name: '提交并保存' }).click()
  await waitForSaved()
  const savedCosts = await apiJson('/api/config')
  const savedCustomCosts = savedCosts?.config?.customCosts ?? {}
  if (importTargets.every((item, index) => Math.abs((savedCustomCosts[item.sku] ?? -1) - importCosts[index]) < 1e-9)) {
    pass('提交并保存后两个 SKU 的补录成本写入配置')
  } else {
    fail(`补录成本未写入配置：${JSON.stringify(savedCustomCosts)}`)
  }

  const summaryAfterImport = await apiJson('/api/summary')
  const stillMissing = new Set((summaryAfterImport?.missingCosts ?? []).map((item) => item.sku))
  if (importTargets.every((item) => !stillMissing.has(item.sku))) pass('保存后服务端缺失列表已移除这两个 SKU')
  else fail('保存后服务端仍报告缺失')
  const productCostDelta = (summaryAfterImport?.totals?.productCost ?? 0) - (missingBefore?.totals?.productCost ?? 0)
  if (Math.abs(productCostDelta - expectedCostDelta) < 1) {
    pass(`补录后产品成本增加 ${productCostDelta.toFixed(2)}（期望 ${expectedCostDelta.toFixed(2)}）`)
  } else {
    fail(`补录后成本变化异常：${productCostDelta.toFixed(2)}，期望 ${expectedCostDelta.toFixed(2)}`)
  }

  await page.locator('.parameter-actions').getByRole('button', { name: '恢复默认参数' }).click()
  await page.locator('.parameter-actions').getByRole('button', { name: '确认恢复' }).click()
  await waitForPreviewDone()
  await page.locator('.parameter-actions').getByRole('button', { name: '提交并保存' }).click()
  await waitForSaved()
  const resetAfterImport = await apiJson('/api/config')
  if (Object.keys(resetAfterImport?.config?.customCosts ?? {}).length === 0) pass('恢复默认并提交后批量补录成本已清空')
  else fail('恢复默认后补录成本未清空')

  // ---- 深色主题 / 1024 宽 ----
  await page.locator('header button[title="切换深色"]').click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(1100)
  await page.screenshot({ path: `${OUT}/03-overview-dark.png`, fullPage: true })
  pass('已截图 03-overview-dark.png')
  await page.locator('header button[title="切换浅色"]').click()
  await page.waitForTimeout(500)

  await page.setViewportSize({ width: 1024, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(900)
  const overflowNarrow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflowNarrow <= 1) pass('1024 宽无横向溢出')
  else fail(`1024 宽存在横向溢出 ${overflowNarrow}px`)
  await page.screenshot({ path: `${OUT}/04-overview-1024.png`, fullPage: true })

  if (consoleErrors.length) fail(`控制台错误 ${consoleErrors.length} 条：${consoleErrors.slice(0, 5).join(' | ')}`)
  else pass('无控制台错误')
} catch (error) {
  fail(`脚本异常：${error.message}`)
} finally {
  await restoreConfig().catch(() => undefined)
  await browser.close()
  const failedCount = results.filter((item) => !item.ok).length
  console.log(`\n通过 ${results.length - failedCount}/${results.length}`)
  if (failedCount) process.exitCode = 1
}
