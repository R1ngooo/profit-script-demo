import { describe, expect, it } from 'vitest'
import type { Config, OrderRow } from '../../shared/types'
import { defaultConfig } from '../../server/config/store'
import { EMPTY_COST, EMPTY_COMMISSION, type Dataset } from '../../server/pipeline/dataset'
import { computeSummary } from '../../server/pipeline/compute'

function row(partial: Partial<OrderRow>): OrderRow {
  return {
    platform: '快手',
    orderNo: 'NO1',
    orderStatus: '交易成功',
    afterSaleStatus: '',
    sku: 'A',
    productCode: 'A',
    productName: '测试商品',
    qty: 1,
    salesAmount: 0,
    shop: '店铺',
    createdAt: '2026-09-01 10:00:00',
    isTest: false,
    sourceFile: '2026.9月快手订单处理.xlsx',
    ...partial,
  }
}

function datasetWith(orders: OrderRow[]): Dataset {
  return {
    orders,
    cost: { ...EMPTY_COST, prices: { A: 10, B: 20 }, rows: 2 },
    ad: {
      byPlatform: { 快手: 30, 视频号: 40 },
      byProduct: {},
      rows: 2,
      warnings: [],
      sourceFile: '月消耗.xlsx',
    },
    commission: EMPTY_COMMISSION,
    files: [],
    warnings: [],
    parseMs: 12,
    cached: true,
    commissionConnected: false,
  }
}

function configWith(patch: (config: Config) => void = () => undefined): Config {
  const config = defaultConfig()
  patch(config)
  return config
}

describe('computeSummary', () => {
  it('结算/退款/成本/广告费与毛利', () => {
    const dataset = datasetWith([
      row({ orderNo: '1', salesAmount: 100, qty: 1, sku: 'A' }),
      row({ orderNo: '2', orderStatus: '交易关闭', afterSaleStatus: '退款成功', salesAmount: 200, qty: 2 }),
      row({
        orderNo: '3',
        platform: '视频号',
        orderStatus: '已完成',
        afterSaleStatus: '退款完成',
        salesAmount: 50,
        qty: 1,
        isTest: false,
        sourceFile: '2026.9月视频号订单处理.xlsx',
      }),
    ])
    const summary = computeSummary(dataset, configWith())

    const kuaishou = summary.platforms.find((pnl) => pnl.platform === '快手')
    expect(kuaishou?.settledSales).toBeCloseTo(100)
    expect(kuaishou?.refundSales).toBeCloseTo(200)
    expect(kuaishou?.settledQty).toBe(1)
    expect(kuaishou?.refundQty).toBe(2)
    expect(kuaishou?.productCost).toBeCloseTo(10)
    expect(kuaishou?.adSpend).toBeCloseTo(30)
    expect(kuaishou?.grossProfit).toBeCloseTo(60)
    expect(kuaishou?.grossMargin).toBeCloseTo(0.6)

    const video = summary.platforms.find((pnl) => pnl.platform === '视频号')
    expect(video?.settledSales).toBe(0)
    expect(video?.refundSales).toBeCloseTo(50)
    expect(video?.grossProfit).toBeCloseTo(-40)
    expect(video?.grossMargin).toBeNull()

    expect(summary.totals.settledSales).toBeCloseTo(100)
    expect(summary.totals.refundSales).toBeCloseTo(250)
    expect(summary.totals.grossProfit).toBeCloseTo(20)
    expect(summary.statusPairs).toHaveLength(3)
  })

  it('人工覆盖优先于自动规则', () => {
    const dataset = datasetWith([
      row({ salesAmount: 100 }),
      row({ orderNo: '2', orderStatus: '交易关闭', afterSaleStatus: '退款成功', salesAmount: 200, qty: 2 }),
    ])
    const config = configWith((draft) => {
      draft.statusOverrides['快手'] = { '交易关闭||退款成功': 'settle' }
    })
    const summary = computeSummary(dataset, config)
    const kuaishou = summary.platforms[0]
    expect(kuaishou.settledSales).toBeCloseTo(300)
    expect(kuaishou.refundSales).toBe(0)
    expect(kuaishou.productCost).toBeCloseTo(30)
    expect(kuaishou.grossProfit).toBeCloseTo(300 - 30 - 30)
    expect(summary.statusPairs.find((pair) => pair.orderStatus === '交易关闭')?.overridden).toBe(true)
  })

  it('刷单订单默认排除，可开关', () => {
    const dataset = datasetWith([row({ salesAmount: 100 }), row({ orderNo: '2', salesAmount: 999, isTest: true })])
    const excluded = computeSummary(dataset, configWith())
    expect(excluded.totals.settledSales).toBeCloseTo(100)
    expect(excluded.stats.testOrders).toBe(1)

    const included = computeSummary(
      dataset,
      configWith((draft) => {
        draft.filters.excludeTestOrders = false
      }),
    )
    expect(included.totals.settledSales).toBeCloseTo(1099)
    expect(included.stats.testOrders).toBe(0)
  })

  it('人工单价优先于成本表并清除缺失清单', () => {
    const dataset = datasetWith([row({ sku: 'C', salesAmount: 100, qty: 2 })])
    const missing = computeSummary(dataset, configWith())
    expect(missing.missingCosts).toHaveLength(1)
    expect(missing.missingCosts[0].sku).toBe('C')
    expect(missing.missingCosts[0].qty).toBe(2)
    expect(missing.totals.productCost).toBe(0)

    const withCost = computeSummary(
      dataset,
      configWith((draft) => {
        draft.customCosts.C = 7.5
      }),
    )
    expect(withCost.missingCosts).toHaveLength(0)
    expect(withCost.totals.productCost).toBeCloseTo(15)
    expect(withCost.totals.grossProfit).toBeCloseTo(100 - 15 - 30)
  })

  it('单位费用与平台费率参与计算', () => {
    const dataset = datasetWith([row({ salesAmount: 100, qty: 2 })])
    const config = configWith((draft) => {
      draft.platforms['快手'].packaging = { mode: 'unit', perUnit: 0.5, total: 0 }
      draft.platforms['快手'].shipping = { mode: 'unit', perUnit: 2, total: 0 }
      draft.platforms['快手'].insurance = { mode: 'unit', perUnit: 0.3, total: 0 }
      draft.platforms['快手'].techFeeRate = 0.006
      draft.platforms['快手'].commercialInsuranceRate = 0.001
    })
    const pnl = computeSummary(dataset, config).platforms[0]
    expect(pnl.packaging).toBeCloseTo(1)
    expect(pnl.shipping).toBeCloseTo(4)
    expect(pnl.shippingInsurance).toBeCloseTo(0.6)
    expect(pnl.techFee).toBeCloseTo(0.6)
    expect(pnl.commercialInsurance).toBeCloseTo(0.1)
    expect(pnl.commission).toBeCloseTo(0)
    expect(pnl.grossProfit).toBeCloseTo(100 - 20 - 1 - 4 - 0.6 - 0.6 - 0.1 - 30)
  })

  it('包装费/运费/运费险支持按件或按总额，且各平台独立', () => {
    const dataset = datasetWith([
      row({ salesAmount: 100, qty: 2 }),
      row({
        platform: '视频号',
        orderNo: 'V1',
        sku: 'B',
        salesAmount: 80,
        qty: 4,
        sourceFile: '视频号.xlsx',
      }),
    ])
    const config = configWith((draft) => {
      draft.platforms['快手'].packaging = { mode: 'unit', perUnit: 0.5, total: 0 }
      draft.platforms['快手'].shipping = { mode: 'total', perUnit: 9, total: 12.5 }
      draft.platforms['快手'].insurance = { mode: 'unit', perUnit: 0.2, total: 0 }
      draft.platforms['视频号'].packaging = { mode: 'total', perUnit: 0.5, total: 7 }
      draft.platforms['视频号'].shipping = { mode: 'unit', perUnit: 1, total: 0 }
      draft.platforms['视频号'].insurance = { mode: 'total', perUnit: 0.3, total: 0.8 }
    })
    const summary = computeSummary(dataset, config)
    const kuaishou = summary.platforms.find((pnl) => pnl.platform === '快手')!
    expect(kuaishou.packaging).toBeCloseTo(1)
    expect(kuaishou.shipping).toBeCloseTo(12.5)
    expect(kuaishou.shippingInsurance).toBeCloseTo(0.4)
    const video = summary.platforms.find((pnl) => pnl.platform === '视频号')!
    expect(video.packaging).toBeCloseTo(7)
    expect(video.shipping).toBeCloseTo(4)
    expect(video.shippingInsurance).toBeCloseTo(0.8)
    expect(summary.totals.packaging).toBeCloseTo(8)
    expect(summary.totals.shipping).toBeCloseTo(16.5)
    expect(summary.totals.shippingInsurance).toBeCloseTo(1.2)
  })

  it('达人佣金：仅预估结算订单产生，退款/未匹配不计', () => {
    const dataset = datasetWith([
      row({ orderNo: 'S1', salesAmount: 100, sku: 'A' }),
      row({ orderNo: 'S2', salesAmount: 200, sku: 'A', orderStatus: '交易关闭', afterSaleStatus: '退款成功' }),
      row({ orderNo: 'S3', salesAmount: 300, sku: 'A' }),
    ])
    dataset.commission = {
      records: [
        { platform: '快手', orderNo: 'S1', sku: 'A', amount: 10, mode: 'line', sourceFile: 'biz.xlsx', sheet: 'Sheet1' },
        { platform: '快手', orderNo: 'S2', sku: 'A', amount: 20, mode: 'line', sourceFile: 'biz.xlsx', sheet: 'Sheet1' },
        { platform: '快手', orderNo: 'S3', sku: 'B', amount: 30, mode: 'line', sourceFile: 'biz.xlsx', sheet: 'Sheet1' },
        { platform: '快手', orderNo: 'NOPE', sku: 'A', amount: 40, mode: 'line', sourceFile: 'biz.xlsx', sheet: 'Sheet1' },
      ],
      leaderRecords: [{ platform: '快手', orderNo: 'L1', amount: 99, sourceFile: 'biz.xlsx', sheet: '团长订单' }],
      duplicateCount: 0,
      duplicateConflicts: 0,
      warnings: [],
    }
    const summary = computeSummary(dataset, configWith())
    const pnl = summary.platforms[0]
    expect(pnl.commission).toBeCloseTo(10)
    expect(pnl.commissionRecords).toBe(1)
    expect(pnl.grossProfit).toBeCloseTo(100 + 300 - 20 - 30 - 10)
    expect(summary.commission.totalRecords).toBe(4)
    expect(summary.commission.matchedRecords).toBe(1)
    expect(summary.commission.refundRecords).toBe(1)
    expect(summary.commission.unmatchedRecords).toBe(1)
    expect(summary.commission.leaderFeeRecords).toBe(1)
    expect(summary.commission.leaderFeeTotal).toBeCloseTo(99)
  })

  it('抖音订单级佣金只计一次，退款订单不计', () => {
    const dataset = datasetWith([
      row({ platform: '抖音', orderNo: 'DY1', sku: 'A', salesAmount: 100, sourceFile: '2026.9月抖音订单.xlsx' }),
      row({ platform: '抖音', orderNo: 'DY1', sku: 'B', salesAmount: 50, sourceFile: '2026.9月抖音订单.xlsx' }),
      row({
        platform: '抖音',
        orderNo: 'DY2',
        sku: 'A',
        salesAmount: 80,
        orderStatus: '已完成',
        afterSaleStatus: '退款完成',
        sourceFile: '2026.9月抖音订单.xlsx',
      }),
    ])
    dataset.commission = {
      records: [
        { platform: '抖音', orderNo: 'DY1', sku: '', amount: 12, mode: 'order', sourceFile: 'biz.xlsx', sheet: '达人订单' },
        { platform: '抖音', orderNo: 'DY2', sku: '', amount: 8, mode: 'order', sourceFile: 'biz.xlsx', sheet: '达人订单' },
      ],
      leaderRecords: [],
      duplicateCount: 0,
      duplicateConflicts: 0,
      warnings: [],
    }
    const summary = computeSummary(dataset, configWith())
    const pnl = summary.platforms.find((item) => item.platform === '抖音')!
    expect(pnl.commission).toBeCloseTo(12)
    expect(summary.commission.byPlatform.find((item) => item.platform === '抖音')?.refundRecords).toBe(1)
  })

  it('无订单源平台广告费默认不并入，开启后计入', () => {
    const dataset = datasetWith([row({ salesAmount: 100 })])
    dataset.ad.byPlatform['抖音'] = 100

    const excluded = computeSummary(dataset, configWith())
    expect(excluded.platforms.map((pnl) => pnl.platform)).not.toContain('抖音')
    expect(excluded.totals.adSpend).toBeCloseTo(30)
    expect(excluded.adSpendByPlatform.find((item) => item.platform === '抖音')?.hasOrders).toBe(false)

    const included = computeSummary(
      dataset,
      configWith((draft) => {
        draft.filters.includeAdPlatformsWithoutOrders = true
      }),
    )
    const douyin = included.platforms.find((pnl) => pnl.platform === '抖音')
    expect(douyin?.grossProfit).toBeCloseTo(-100)
    expect(included.totals.adSpend).toBeCloseTo(170)
  })

  it('缺失成本给出同名商品建议价', () => {
    const dataset = datasetWith([row({ sku: 'D', productName: '大王美背', salesAmount: 10, qty: 1 })])
    dataset.cost.namePrices['大王美背'] = [5, 5.8, 17.4]
    const summary = computeSummary(dataset, configWith())
    expect(summary.missingCosts[0].suggestion).toBeCloseTo(5.8)
    expect(summary.missingCosts[0].suggestionSource).toBe('成本表同名商品')
  })
})
