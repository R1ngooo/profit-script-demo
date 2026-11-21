import type {
  AdSpendRow,
  Classification,
  CommissionPlatformStat,
  CommissionStats,
  Config,
  DatasetStats,
  MissingCost,
  ParseWarning,
  PlatformPnl,
  StatusPair,
  Summary,
} from '../../shared/types'
import { MISSING_COST_SUGGESTION_RATE, feeAmount, pairKey, statusPairId } from '../../shared/types'
import { classifyStatus } from '../../shared/rules'
import { normalizePlatform, safeDivide } from '../util/numbers'
import type { Dataset } from './dataset'

export const PLATFORM_ORDER = ['快手', '视频号', '抖音', '天猫', '拼多多', '京东', '小红书']

function platformRank(name: string): number {
  const index = PLATFORM_ORDER.indexOf(name)
  return index === -1 ? PLATFORM_ORDER.length : index
}

function emptyPnl(platform: string): PlatformPnl {
  return {
    platform,
    orderRows: 0,
    settleRows: 0,
    refundRows: 0,
    settledSales: 0,
    refundSales: 0,
    settledQty: 0,
    refundQty: 0,
    productCost: 0,
    packaging: 0,
    shipping: 0,
    shippingInsurance: 0,
    techFee: 0,
    commercialInsurance: 0,
    commission: 0,
    adSpend: 0,
    grossProfit: 0,
    grossMargin: null,
    missingCostQty: 0,
    missingCostSkus: 0,
    costCoverage: null,
    commissionRecords: 0,
  }
}

interface PairAccumulator {
  id: string
  platform: string
  orderStatus: string
  afterSaleStatus: string
  rows: number
  qty: number
  sales: number
  auto: Classification
  effective: Classification
  overridden: boolean
  ruleId: string
  reason: string
  unknown: boolean
}

interface MissingAccumulator {
  sku: string
  productName: string
  platforms: Set<string>
  qty: number
  rows: number
  sales: number
}

interface PlatformInternal {
  pnl: PlatformPnl
  costMatchedQty: number
  missingSkus: Set<string>
}

interface CommissionAccumulator {
  records: number
  amount: number
  matchedRecords: number
  matchedAmount: number
  unmatchedRecords: number
  unmatchedAmount: number
  refundRecords: number
  refundAmount: number
  skuMismatchRecords: number
  skuMismatchAmount: number
}

function emptyCommissionAcc(): CommissionAccumulator {
  return {
    records: 0,
    amount: 0,
    matchedRecords: 0,
    matchedAmount: 0,
    unmatchedRecords: 0,
    unmatchedAmount: 0,
    refundRecords: 0,
    refundAmount: 0,
    skuMismatchRecords: 0,
    skuMismatchAmount: 0,
  }
}

/** 订单/订单行结算状态位：按位或后判断（1=含结算行，2=含退款行） */
const SETTLE_BIT = 1
const REFUND_BIT = 2

function periodFromName(name: string | undefined): string | null {
  if (!name) return null
  const match = name.match(/(\d{4})\s*[年.\-]?\s*(\d{1,2})\s*月/)
  if (match) return `${match[1]}年${Number(match[2])}月`
  return null
}

export function computeSummary(dataset: Dataset, config: Config): Summary {
  const includeAdOnly = config.filters.includeAdPlatformsWithoutOrders
  const excludeTest = config.filters.excludeTestOrders

  // 文件级平台映射缓存：订单行的 platform 已是规范名，仅异常文件才需要回退
  const platformBySource = new Map<string, string>()
  const resolvePlatform = (row: { platform: string; sourceFile: string }): string => {
    if (row.platform) return row.platform
    const cached = platformBySource.get(row.sourceFile)
    if (cached) return cached
    const mapped = normalizePlatform(config.filePlatformMap[row.sourceFile] ?? '')
    const name = mapped || '未识别'
    platformBySource.set(row.sourceFile, name)
    return name
  }

  // 行级佣金（快手/视频号）才需要 SKU 维度索引，订单级佣金（抖音）只需订单号
  const lineCommissionPlatforms = new Set<string>()
  for (const record of dataset.commission.records) {
    if (record.mode === 'line' && record.sku) {
      lineCommissionPlatforms.add(normalizePlatform(record.platform) || '未识别')
    }
  }

  const platformMap = new Map<string, PlatformInternal>()
  const missingMap = new Map<string, MissingAccumulator>()
  const pairMap = new Map<string, PairAccumulator>()
  /** 订单号 → 结算状态位（含抖音子订单号别名） */
  const orderSettleIndex = new Map<string, number>()
  /** 平台+订单号+SKU → 结算状态位（仅行级佣金平台） */
  const skuSettleIndex = new Map<string, number>()

  let testOrders = 0
  let includedOrders = 0

  const getPlatform = (name: string): PlatformInternal => {
    let entry = platformMap.get(name)
    if (!entry) {
      entry = { pnl: emptyPnl(name), costMatchedQty: 0, missingSkus: new Set() }
      platformMap.set(name, entry)
    }
    return entry
  }

  // 单次遍历订单：同时完成状态组合聚合、平台聚合与佣金匹配索引
  for (const row of dataset.orders) {
    if (excludeTest && row.isTest) {
      testOrders += 1
      continue
    }
    includedOrders += 1

    const platform = resolvePlatform(row)
    const entry = getPlatform(platform)
    const pnl = entry.pnl
    pnl.orderRows += 1

    const pairCacheKey = `${platform}\u0001${row.orderStatus}\u0001${row.afterSaleStatus}`
    let pair = pairMap.get(pairCacheKey)
    if (!pair) {
      const auto = classifyStatus(row.orderStatus, row.afterSaleStatus)
      const override = config.statusOverrides[platform]?.[pairKey(row.orderStatus, row.afterSaleStatus)]
      pair = {
        id: statusPairId(platform, row.orderStatus, row.afterSaleStatus),
        platform,
        orderStatus: row.orderStatus,
        afterSaleStatus: row.afterSaleStatus,
        rows: 0,
        qty: 0,
        sales: 0,
        auto: auto.classification,
        effective: override ?? auto.classification,
        overridden: override !== undefined,
        ruleId: auto.ruleId,
        reason: override !== undefined ? '人工拖拽归类（优先于自动规则）' : auto.reason,
        unknown: auto.unknown,
      }
      pairMap.set(pairCacheKey, pair)
    }
    pair.rows += 1
    pair.qty += row.qty
    pair.sales += row.salesAmount

    const refund = pair.effective === 'refund'
    const bit = refund ? REFUND_BIT : SETTLE_BIT
    const orderKey = `${platform}\u0001${row.orderNo}`
    orderSettleIndex.set(orderKey, (orderSettleIndex.get(orderKey) ?? 0) | bit)
    const subOrderNo = row.subOrderNo?.trim()
    if (subOrderNo && subOrderNo !== row.orderNo) {
      const subKey = `${platform}\u0001${subOrderNo}`
      orderSettleIndex.set(subKey, (orderSettleIndex.get(subKey) ?? 0) | bit)
    }
    if (lineCommissionPlatforms.has(platform)) {
      const skuKey = `${platform}\u0001${row.orderNo}\u0001${row.sku}`
      skuSettleIndex.set(skuKey, (skuSettleIndex.get(skuKey) ?? 0) | bit)
    }

    if (refund) {
      pnl.refundRows += 1
      pnl.refundSales += row.salesAmount
      pnl.refundQty += row.qty
      continue
    }

    pnl.settleRows += 1
    pnl.settledSales += row.salesAmount
    pnl.settledQty += row.qty

    const customCost = config.customCosts[row.sku]
    const tableCost = dataset.cost.prices[row.sku]
    if (customCost !== undefined) {
      pnl.productCost += customCost * row.qty
      entry.costMatchedQty += row.qty
    } else if (tableCost !== undefined) {
      pnl.productCost += tableCost * row.qty
      entry.costMatchedQty += row.qty
    } else {
      const key = row.sku || `__empty__:${row.productName}`
      let missing = missingMap.get(key)
      if (!missing) {
        missing = { sku: row.sku, productName: row.productName, platforms: new Set(), qty: 0, rows: 0, sales: 0 }
        missingMap.set(key, missing)
      }
      missing.qty += row.qty
      missing.rows += 1
      missing.sales += row.salesAmount
      missing.platforms.add(platform)
      if (!missing.productName && row.productName) missing.productName = row.productName
      entry.missingSkus.add(key)
      pnl.missingCostQty += row.qty
    }
  }

  const statusPairs: StatusPair[] = []
  for (const pair of pairMap.values()) {
    statusPairs.push({
      id: pair.id,
      platform: pair.platform,
      orderStatus: pair.orderStatus,
      afterSaleStatus: pair.afterSaleStatus,
      rows: pair.rows,
      qty: pair.qty,
      sales: pair.sales,
      auto: pair.auto,
      effective: pair.effective,
      overridden: pair.overridden,
      ruleId: pair.ruleId,
      reason: pair.reason,
      unknown: pair.unknown,
    })
  }
  statusPairs.sort((a, b) => platformRank(a.platform) - platformRank(b.platform) || b.sales - a.sales)

  // 达人佣金（商务订单匹配）：仅预估结算订单产生佣金
  const commissionAcc = new Map<string, CommissionAccumulator>()
  const getCommissionAcc = (name: string): CommissionAccumulator => {
    let acc = commissionAcc.get(name)
    if (!acc) {
      acc = emptyCommissionAcc()
      commissionAcc.set(name, acc)
    }
    return acc
  }

  let leaderFeeRecords = 0
  let leaderFeeTotal = 0
  for (const record of dataset.commission.leaderRecords) {
    leaderFeeRecords += 1
    leaderFeeTotal += record.amount
  }

  for (const record of dataset.commission.records) {
    const platform = normalizePlatform(record.platform) || '未识别'
    const acc = getCommissionAcc(platform)
    acc.records += 1
    acc.amount += record.amount
    const orderMask = orderSettleIndex.get(`${platform}\u0001${record.orderNo}`) ?? 0
    if (!orderMask) {
      acc.unmatchedRecords += 1
      acc.unmatchedAmount += record.amount
      continue
    }
    let matched: boolean
    if (record.mode === 'order' || !record.sku) {
      matched = (orderMask & SETTLE_BIT) !== 0
    } else {
      const skuMask = skuSettleIndex.get(`${platform}\u0001${record.orderNo}\u0001${record.sku}`)
      if (skuMask === undefined) {
        if (orderMask & SETTLE_BIT) {
          acc.skuMismatchRecords += 1
          acc.skuMismatchAmount += record.amount
          continue
        }
        matched = false
      } else {
        matched = (skuMask & SETTLE_BIT) !== 0
      }
    }
    if (matched) {
      acc.matchedRecords += 1
      acc.matchedAmount += record.amount
    } else {
      acc.refundRecords += 1
      acc.refundAmount += record.amount
    }
  }

  // 广告费
  const adByPlatform: Record<string, number> = {}
  for (const [platform, spend] of Object.entries(dataset.ad.byPlatform)) {
    const name = normalizePlatform(platform)
    if (!name) continue
    adByPlatform[name] = (adByPlatform[name] ?? 0) + spend
  }

  const orderPlatformNames = [...platformMap.keys()]
  const adOnlyPlatforms = Object.keys(adByPlatform).filter((name) => !platformMap.has(name))
  const allPlatformNames = [...orderPlatformNames]
  if (includeAdOnly) {
    for (const name of adOnlyPlatforms) allPlatformNames.push(name)
  }
  allPlatformNames.sort((a, b) => platformRank(a) - platformRank(b) || a.localeCompare(b))

  for (const name of allPlatformNames) {
    const entry = getPlatform(name)
    const pnl = entry.pnl
    const pc = config.platforms[name]
    pnl.productCost = roundValue(pnl.productCost)
    pnl.packaging = feeAmount(pc?.packaging, pnl.settledQty)
    pnl.shipping = feeAmount(pc?.shipping, pnl.settledQty)
    pnl.shippingInsurance = feeAmount(pc?.insurance, pnl.settledQty)
    pnl.techFee = (pc?.techFeeRate ?? 0) * pnl.settledSales
    pnl.commercialInsurance = (pc?.commercialInsuranceRate ?? 0) * pnl.settledSales
    const commissionEntry = commissionAcc.get(name)
    pnl.commission = commissionEntry?.matchedAmount ?? 0
    pnl.commissionRecords = commissionEntry?.matchedRecords ?? 0
    pnl.adSpend = adByPlatform[name] ?? 0
    pnl.grossProfit =
      pnl.settledSales -
      pnl.productCost -
      pnl.packaging -
      pnl.shipping -
      pnl.shippingInsurance -
      pnl.techFee -
      pnl.commercialInsurance -
      pnl.commission -
      pnl.adSpend
    pnl.grossMargin = safeDivide(pnl.grossProfit, pnl.settledSales)
    pnl.missingCostSkus = entry.missingSkus.size
    pnl.costCoverage = safeDivide(entry.costMatchedQty, pnl.settledQty)
  }

  const platforms = allPlatformNames.map((name) => platformMap.get(name)!.pnl)

  // 达人佣金统计（商务订单口径）
  const commissionPlatformNames = [...new Set([...orderPlatformNames, ...commissionAcc.keys()])].sort(
    (a, b) => platformRank(a) - platformRank(b) || a.localeCompare(b),
  )
  const commissionByPlatform: CommissionPlatformStat[] = commissionPlatformNames.map((name) => {
    const acc = commissionAcc.get(name) ?? emptyCommissionAcc()
    return {
      platform: name,
      records: acc.records,
      amount: acc.amount,
      matchedRecords: acc.matchedRecords,
      matchedAmount: acc.matchedAmount,
      unmatchedRecords: acc.unmatchedRecords,
      unmatchedAmount: acc.unmatchedAmount,
      refundRecords: acc.refundRecords,
      refundAmount: acc.refundAmount,
    }
  })
  const sumBy = (pick: (item: CommissionAccumulator) => number) =>
    [...commissionAcc.values()].reduce((sum, acc) => sum + pick(acc), 0)

  const commissionWarnings: string[] = []
  const unmatchedRecords = sumBy((acc) => acc.unmatchedRecords)
  const unmatchedAmount = sumBy((acc) => acc.unmatchedAmount)
  const skuMismatchRecords = sumBy((acc) => acc.skuMismatchRecords)
  const skuMismatchAmount = sumBy((acc) => acc.skuMismatchAmount)
  const missingCommissionPlatforms = orderPlatformNames.filter((name) => !commissionAcc.has(name))
  if (unmatchedRecords > 0) {
    commissionWarnings.push(
      `达人佣金有 ${unmatchedRecords} 条记录未能匹配到订单（金额 ${unmatchedAmount.toFixed(2)}），已按 0 计`,
    )
  }
  if (skuMismatchRecords > 0) {
    commissionWarnings.push(
      `达人佣金有 ${skuMismatchRecords} 条记录订单号能匹配但 SKU 不一致（金额 ${skuMismatchAmount.toFixed(2)}），未计入`,
    )
  }
  if (missingCommissionPlatforms.length) {
    commissionWarnings.push(
      `以下平台有订单但未提供商务佣金数据，达人佣金按 0 计：${missingCommissionPlatforms.join('、')}`,
    )
  }
  if (leaderFeeRecords) {
    commissionWarnings.push(`商务数据中 ${leaderFeeRecords} 条团长服务费已忽略（本期仅统计达人佣金）`)
  }
  if (!dataset.commission.records.length) {
    commissionWarnings.push('未读取到任何达人佣金记录，全部平台达人佣金按 0 计')
  }

  const commissionStats: CommissionStats = {
    totalRecords: sumBy((acc) => acc.records),
    totalAmount: sumBy((acc) => acc.amount),
    matchedRecords: sumBy((acc) => acc.matchedRecords),
    matchedAmount: sumBy((acc) => acc.matchedAmount),
    unmatchedRecords,
    unmatchedAmount,
    refundRecords: sumBy((acc) => acc.refundRecords),
    refundAmount: sumBy((acc) => acc.refundAmount),
    byPlatform: commissionByPlatform,
    leaderFeeRecords,
    leaderFeeTotal,
    files: dataset.files.filter((file) => file.kind === 'commission'),
    warnings: commissionWarnings,
  }

  // 缺失成本清单：建议价统一按「客单价（销售金额 ÷ 结算数量）× 33%」估算
  const missingCosts: MissingCost[] = []
  for (const missing of missingMap.values()) {
    if (missing.qty <= 0) continue
    const unitPrice = missing.sales / missing.qty
    const suggestion = Math.round(unitPrice * MISSING_COST_SUGGESTION_RATE * 100) / 100
    const suggestionSource = '客单价 × 33%'
    const override = missing.sku ? config.customCosts[missing.sku] : undefined
    missingCosts.push({
      sku: missing.sku,
      productName: missing.productName,
      platforms: [...missing.platforms],
      qty: missing.qty,
      settledQty: missing.qty,
      rows: missing.rows,
      sales: missing.sales,
      suggestion,
      suggestionSource,
      override: override ?? null,
    })
  }
  missingCosts.sort((a, b) => b.qty - a.qty)

  // 合计
  const totals = emptyPnl('合计')
  for (const pnl of platforms) {
    totals.orderRows += pnl.orderRows
    totals.settleRows += pnl.settleRows
    totals.refundRows += pnl.refundRows
    totals.settledSales += pnl.settledSales
    totals.refundSales += pnl.refundSales
    totals.settledQty += pnl.settledQty
    totals.refundQty += pnl.refundQty
    totals.productCost += pnl.productCost
    totals.packaging += pnl.packaging
    totals.shipping += pnl.shipping
    totals.shippingInsurance += pnl.shippingInsurance
    totals.techFee += pnl.techFee
    totals.commercialInsurance += pnl.commercialInsurance
    totals.commission += pnl.commission
    totals.commissionRecords += pnl.commissionRecords
    totals.adSpend += pnl.adSpend
    totals.missingCostQty += pnl.missingCostQty
    totals.missingCostSkus += pnl.missingCostSkus
  }
  totals.grossProfit =
    totals.settledSales -
    totals.productCost -
    totals.packaging -
    totals.shipping -
    totals.shippingInsurance -
    totals.techFee -
    totals.commercialInsurance -
    totals.commission -
    totals.adSpend
  totals.grossMargin = safeDivide(totals.grossProfit, totals.settledSales)
  totals.costCoverage = safeDivide(
    platforms.reduce((sum, pnl) => sum + (pnl.costCoverage ?? 0) * pnl.settledQty, 0),
    totals.settledQty,
  )

  // 广告费明细 / 警告
  const adSpendByPlatform: AdSpendRow[] = Object.entries(adByPlatform)
    .map(([platform, spend]) => ({
      platform,
      spend,
      hasOrders: platformMap.has(platform),
      files: dataset.files.filter((file) => file.kind === 'ad').map((file) => file.name),
    }))
    .sort((a, b) => b.spend - a.spend)

  const warnings: string[] = []
  if (missingCosts.length) {
    warnings.push(
      `有 ${missingCosts.length} 个 SKU 未匹配到成本（涉及结算商品 ${Math.round(
        missingCosts.reduce((sum, item) => sum + item.qty, 0),
      )} 件），当前按 0 计成本，请在「人工填写」中补录单价`,
    )
  }
  const unknownCount = statusPairs.filter((pair) => pair.unknown && !pair.overridden).length
  if (unknownCount) {
    warnings.push(`有 ${unknownCount} 组状态组合未被自动规则识别，已在「状态判定」中标黄，建议人工确认`)
  }
  if (adOnlyPlatforms.length) {
    warnings.push(
      `月消耗表中 ${adOnlyPlatforms.join('、')} 有广告消耗但没有订单源，默认不计入总毛利${
        includeAdOnly ? '（当前已并入）' : ''
      }`,
    )
  }
  for (const warning of dataset.warnings) warnings.push(warning)
  for (const warning of commissionWarnings) warnings.push(warning)

  const parseWarnings: ParseWarning[] = dataset.files.flatMap((file) =>
    file.warnings.map((message) => ({ file: file.name, message, count: 1 })),
  )

  const stats: DatasetStats = {
    totalOrders: dataset.orders.length,
    includedOrders,
    refundOrders: platforms.reduce((sum, pnl) => sum + pnl.refundRows, 0),
    testOrders,
    parseMs: dataset.parseMs,
    cached: dataset.cached,
  }

  const firstOrderFile = dataset.files.find((file) => file.kind === 'order')
  const period =
    dataset.files
      .filter((file) => file.kind === 'order')
      .map((file) => periodFromName(file.name))
      .find((value) => value !== null) ??
    periodFromName(firstOrderFile?.name) ??
    periodFromName(dataset.files.find((file) => file.kind === 'ad')?.name)

  return {
    generatedAt: new Date().toISOString(),
    period: period ?? null,
    platforms,
    totals,
    adSpendByPlatform,
    statusPairs,
    missingCosts,
    commission: commissionStats,
    dataset: dataset.files,
    warnings: [...new Set(warnings)],
    parseWarnings,
    stats,
  }
}

function roundValue(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6
}
