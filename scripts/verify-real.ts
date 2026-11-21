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

expect('订单行数', dataset.orders.length, 528733, 0)
expect('历史数据文件数（应为 0）', dataset.files.filter((file) => file.path.includes('历史数据')).length, 0, 0)
expect(
  '历史数据忽略提示',
  summary.warnings.some((warning) => warning.includes('已忽略「历史数据」文件夹')) ? 1 : 0,
  1,
  0,
)
expect('平台数', summary.platforms.length, 7, 0)
expect('状态组合数', summary.statusPairs.length, 98, 0)
expect('缺失成本 SKU 数', summary.missingCosts.length, 406, 0)

const PLATFORM_EXPECTATIONS: Array<{
  platform: string
  settled: number
  refund: number
  qty: number
  cost: number
  ad: number
  commission: number
}> = [
  { platform: '快手', settled: 943031.9, refund: 341618.1, qty: 17299, cost: 241204.03, ad: 0, commission: 1091.67 },
  { platform: '视频号', settled: 2248534.5, refund: 869954, qty: 34568, cost: 511142.68, ad: 0, commission: 200953.92 },
  { platform: '抖音', settled: 12960094.07, refund: 5527114.48, qty: 233270, cost: 3957830.03, ad: 0, commission: 459551.83 },
  { platform: '天猫', settled: 3081728.92, refund: 55927.69, qty: 91165, cost: 890898.67, ad: 0, commission: 0 },
  { platform: '拼多多', settled: 2312418.72, refund: 1175307.79, qty: 41435, cost: 663872.67, ad: 0, commission: 0 },
  { platform: '京东', settled: 182582.45, refund: 21678.68, qty: 3799, cost: 58694.6, ad: 0, commission: 0 },
  { platform: '小红书', settled: 29920.1, refund: 7738.2, qty: 558, cost: 10345.44, ad: 0, commission: 0 },
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

expect('合计预估结算金额', summary.totals.settledSales, 21758310.66)
expect('合计产品成本', summary.totals.productCost, 6333988.12, 0.1)
expect('合计达人佣金', summary.totals.commission, 661597.42, 0.05)
expect('合计广告费', summary.totals.adSpend, 0, 0.05)
expect('合计毛利', summary.totals.grossProfit, 14762725.12, 0.1)
expect('佣金记录数', summary.commission.totalRecords, 55395, 0)
expect('佣金总额', summary.commission.totalAmount, 1252306.77, 0.05)
expect('佣金计入毛利', summary.commission.matchedAmount, 661597.42, 0.05)
expect('佣金退款不计', summary.commission.refundAmount, 289723.9, 0.05)
expect('佣金未匹配金额', summary.commission.unmatchedAmount, 300985.45, 0.05)
expect('团长服务费记录', summary.commission.leaderFeeRecords, 12587, 0)
expect(
  '缺失成本件数',
  Math.round(summary.missingCosts.reduce((sum, item) => sum + item.settledQty, 0)),
  72467,
  0,
)

if (failed) {
  console.error(`\n${failed} 项校验未通过`)
  process.exitCode = 1
} else {
  console.log('\n全部基线校验通过')
}
