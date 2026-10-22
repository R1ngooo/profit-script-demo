/**
 * 真实数据回归校验：跑完整解析 + 计算管线，并断言与基线一致。
 * 用法：
 *   npm run verify:real            # 有缓存时读缓存
 *   npm run verify:real -- --force # 强制重新解析（首次约 2~3 分钟）
 */
import path from 'node:path'
import { ConfigStore, defaultConfig } from '../server/config/store'
import { DatasetService } from '../server/pipeline/dataset'
import { computeSummary } from '../server/pipeline/compute'

const root = process.cwd()
const force = process.argv.includes('--force')
const configStore = new ConfigStore(path.join(root, 'data'))
const service = new DatasetService(path.join(root, 'excel'), path.join(root, 'data'), configStore)

const startedAt = Date.now()
const dataset = await service.ensure(force)
// 回归基线使用默认配置（人工费用为 0、无补录成本、无归类覆盖），避免依赖本机已保存参数
const config = defaultConfig(service.platformNames())
const summary = computeSummary(dataset, config)

const format = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

console.log(`解析用时：${((Date.now() - startedAt) / 1000).toFixed(1)}s（cached=${dataset.cached}）`)
console.log(`订单行：${dataset.orders.length}`)
for (const pnl of summary.platforms) {
  console.log(
    [
      pnl.platform.padEnd(4, ' '),
      `结算额 ${format(pnl.settledSales)}`,
      `退款额 ${format(pnl.refundSales)}`,
      `结算件数 ${pnl.settledQty}`,
      `成本 ${format(pnl.productCost)}`,
      `达人佣金 ${format(pnl.commission)}`,
      `广告费 ${format(pnl.adSpend)}`,
      `毛利 ${format(pnl.grossProfit)}`,
    ].join(' | '),
  )
}
console.log(
  `合计 结算额 ${format(summary.totals.settledSales)} | 成本 ${format(summary.totals.productCost)} | 达人佣金 ${format(
    summary.totals.commission,
  )} | 广告费 ${format(summary.totals.adSpend)} | 毛利 ${format(summary.totals.grossProfit)}`,
)
console.log(`状态组合：${summary.statusPairs.length}；缺失成本 SKU：${summary.missingCosts.length}`)
console.log(
  `达人佣金：记录 ${summary.commission.totalRecords} 条 / 总额 ${format(summary.commission.totalAmount)}，计入毛利 ${format(
    summary.commission.matchedAmount,
  )}（${summary.commission.matchedRecords} 条）`,
)
console.log(
  `佣金匹配：退款不计 ${format(summary.commission.refundAmount)}；未匹配 ${format(
    summary.commission.unmatchedAmount,
  )}；团长服务费忽略 ${summary.commission.leaderFeeRecords} 条 / ${format(summary.commission.leaderFeeTotal)}`,
)
for (const warning of summary.warnings) console.log(`! ${warning}`)

let failed = 0
function expect(name: string, actual: number, expected: number, tolerance = 0.02) {
  const ok = Math.abs(actual - expected) <= tolerance
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${name}: ${actual} (期望 ${expected} ±${tolerance})`)
}

const byPlatform = new Map(summary.platforms.map((pnl) => [pnl.platform, pnl]))

expect('订单行数', dataset.orders.length, 636752, 0)
expect('平台数', summary.platforms.length, 7, 0)
expect('状态组合数', summary.statusPairs.length, 98, 0)
expect('缺失成本 SKU 数', summary.missingCosts.length, 151, 0)

const PLATFORM_EXPECTATIONS: Array<{
  platform: string
  settled: number
  refund: number
  qty: number
  cost: number
  ad: number
  commission: number
}> = [
  { platform: '快手', settled: 850126.3, refund: 189475.9, qty: 18916, cost: 281000.09, ad: 458041.0, commission: 1295.16 },
  { platform: '视频号', settled: 2711588.9, refund: 709530.9, qty: 45088, cost: 723458.23, ad: 1857820.12, commission: 1443.77 },
  { platform: '抖音', settled: 16135806.89, refund: 6816283.2, qty: 318712, cost: 5240097.39, ad: 8441408.74, commission: 127167.07 },
  { platform: '天猫', settled: 2226420.83, refund: 40404.52, qty: 43904, cost: 700893.58, ad: 1000609.89, commission: 0 },
  { platform: '拼多多', settled: 1648930.78, refund: 598139.03, qty: 34853, cost: 619238.34, ad: 641366.81, commission: 0 },
  { platform: '京东', settled: 126268.43, refund: 13513.72, qty: 2524, cost: 41001.8, ad: 63854.45, commission: 0 },
  { platform: '小红书', settled: 40737.7, refund: 8849.3, qty: 914, cost: 14822.42, ad: 7984.91, commission: 0 },
]

for (const item of PLATFORM_EXPECTATIONS) {
  const pnl = byPlatform.get(item.platform)
  if (!pnl) {
    failed += 1
    console.log(`✗ 缺少平台 ${item.platform}`)
    continue
  }
  expect(`${item.platform} 预估结算金额`, pnl.settledSales, item.settled)
  expect(`${item.platform} 退款销售额`, pnl.refundSales, item.refund)
  expect(`${item.platform} 结算件数`, pnl.settledQty, item.qty, 0)
  expect(`${item.platform} 产品成本`, pnl.productCost, item.cost, 0.05)
  expect(`${item.platform} 广告费`, pnl.adSpend, item.ad)
  expect(`${item.platform} 达人佣金`, pnl.commission, item.commission, 0.05)
}

expect('合计预估结算金额', summary.totals.settledSales, 23739879.83)
expect('合计产品成本', summary.totals.productCost, 7620511.85, 0.1)
expect('合计达人佣金', summary.totals.commission, 129906.0, 0.05)
expect('合计广告费', summary.totals.adSpend, 12471085.92, 0.05)
expect('合计毛利', summary.totals.grossProfit, 3518376.06, 0.1)
expect('佣金记录数', summary.commission.totalRecords, 9513, 0)
expect('佣金总额', summary.commission.totalAmount, 200595.22, 0.05)
expect('佣金计入毛利', summary.commission.matchedAmount, 129906.0, 0.05)
expect('佣金退款不计', summary.commission.refundAmount, 41679.64, 0.05)
expect('佣金未匹配金额', summary.commission.unmatchedAmount, 29009.58, 0.05)
expect('团长服务费记录', summary.commission.leaderFeeRecords, 507, 0)

if (failed) {
  console.error(`\n${failed} 项校验未通过`)
  process.exitCode = 1
} else {
  console.log('\n全部基线校验通过')
}
