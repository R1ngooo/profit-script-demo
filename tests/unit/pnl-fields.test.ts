import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PNL_FIELD_ORDER,
  PNL_TABLE_FIELDS,
  PRODUCT_COST_RATIO_BENCHMARK,
  feeAmount,
  normalizeFieldOrder,
  pnlFieldValue,
  productCostRatio,
  refundRatio,
} from '../../shared/types'
import type { PlatformPnl } from '../../shared/types'

function pnl(patch: Partial<PlatformPnl> = {}): PlatformPnl {
  return {
    platform: '快手',
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
    ...patch,
  }
}

describe('毛利表新增比率字段', () => {
  it('产品成本费比 = 产品成本 / 预估结算金额', () => {
    const ratio = productCostRatio(pnl({ productCost: 281000.09, settledSales: 850126.3 }))
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeCloseTo(0.33054, 4)
    expect(PRODUCT_COST_RATIO_BENCHMARK).toBe(0.3)
    expect(productCostRatio(pnl({ settledSales: 0 }))).toBeNull()
    expect(productCostRatio(pnl({ settledSales: -1 }))).toBeNull()
  })

  it('退款比例 = 退款额 / (预估结算金额 + 退款额)', () => {
    expect(refundRatio(pnl({ refundSales: 100, settledSales: 900 }))).toBeCloseTo(0.1)
    expect(refundRatio(pnl({ refundSales: 0, settledSales: 0 }))).toBeNull()
  })

  it('比率字段可统一取值', () => {
    const row = pnl({ productCost: 30, settledSales: 100, refundSales: 25, grossProfit: 12 })
    expect(pnlFieldValue(row, 'productCostRatio')).toBeCloseTo(0.3)
    expect(pnlFieldValue(row, 'refundRatio')).toBeCloseTo(0.2)
    expect(pnlFieldValue(row, 'grossProfit')).toBe(12)
    expect(pnlFieldValue(row, 'unknownField')).toBeNull()
  })

  it('字段定义中包含费比与退款比例，且仅费比带 30% 参考线', () => {
    const labels = PNL_TABLE_FIELDS.map((field) => field.label)
    expect(labels).toContain('产品成本费比')
    expect(labels).toContain('退款比例')
    const warnFields = PNL_TABLE_FIELDS.filter((field) => field.warnBelow !== undefined)
    expect(warnFields).toHaveLength(1)
    expect(warnFields[0].key).toBe('productCostRatio')
    expect(warnFields[0].warnBelow).toBe(0.3)
  })
})

describe('自定义字段排序', () => {
  it('过滤未知字段、去重并补齐缺失字段', () => {
    const order = normalizeFieldOrder(['grossProfit', 'unknown', 'settledSales', 'grossProfit'])
    const rest = DEFAULT_PNL_FIELD_ORDER.filter((key) => !['grossProfit', 'settledSales'].includes(key))
    expect(order).toEqual(['grossProfit', 'settledSales', ...rest])
    expect(order).toHaveLength(DEFAULT_PNL_FIELD_ORDER.length)
  })

  it('空值回退默认顺序', () => {
    expect(normalizeFieldOrder(null)).toEqual(DEFAULT_PNL_FIELD_ORDER)
    expect(normalizeFieldOrder([])).toEqual(DEFAULT_PNL_FIELD_ORDER)
  })

  it('默认顺序覆盖全部字段', () => {
    expect([...DEFAULT_PNL_FIELD_ORDER].sort()).toEqual(PNL_TABLE_FIELDS.map((field) => field.key).sort())
  })
})

describe('费用两种计算方式', () => {
  it('按件模式 = 单价 × 结算商品数量', () => {
    expect(feeAmount({ mode: 'unit', perUnit: 1.5, total: 999 }, 10)).toBeCloseTo(15)
    expect(feeAmount({ mode: 'unit', perUnit: 0, total: 999 }, 10)).toBe(0)
  })

  it('按总额模式直接使用填写的总额，与数量无关', () => {
    expect(feeAmount({ mode: 'total', perUnit: 1.5, total: 999 }, 10)).toBeCloseTo(999)
    expect(feeAmount({ mode: 'total', perUnit: 1.5, total: 999 }, 0)).toBeCloseTo(999)
  })

  it('未配置或数量为 0 时按件模式为 0', () => {
    expect(feeAmount(undefined, 10)).toBe(0)
    expect(feeAmount({ mode: 'unit', perUnit: 2, total: 0 }, 0)).toBe(0)
  })
})
