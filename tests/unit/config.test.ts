import { describe, expect, it } from 'vitest'
import { DEFAULT_PNL_FIELD_ORDER } from '../../shared/types'
import type { Config } from '../../shared/types'
import { defaultConfig, normalizeConfig } from '../../server/config/store'

const fee = (mode: 'unit' | 'total', perUnit = 0, total = 0) => ({ mode, perUnit, total })

describe('配置规范化', () => {
  it('补齐平台默认项（三项费用支持两种算法）', () => {
    const config = normalizeConfig({})
    expect(config.version).toBe(1)
    expect(config.filters.excludeTestOrders).toBe(true)
    expect(config.platforms['快手']).toEqual({
      packaging: fee('unit'),
      shipping: fee('unit'),
      insurance: fee('unit'),
      techFeeRate: 0,
      commercialInsuranceRate: 0,
    })
  })

  it('保留新结构的费用设置与用户输入', () => {
    const input = {
      platforms: {
        视频号: {
          packaging: { mode: 'total', total: 1234.5 },
          shipping: { mode: 'unit', perUnit: 2 },
          insurance: { mode: 'unit', perUnit: 0.3 },
          techFeeRate: 0.006,
        },
      },
      customCosts: { '8689#黑L': 9.9 },
    }
    const config = normalizeConfig(input)
    expect(config.platforms['视频号'].packaging).toEqual({ mode: 'total', perUnit: 0, total: 1234.5 })
    expect(config.platforms['视频号'].shipping).toEqual({ mode: 'unit', perUnit: 2, total: 0 })
    expect(config.platforms['视频号'].insurance.perUnit).toBe(0.3)
    expect(config.platforms['视频号'].techFeeRate).toBe(0.006)
    expect(config.customCosts['8689#黑L']).toBe(9.9)
  })

  it('旧配置自动迁移：全局包装费/运费与按件运费险', () => {
    const legacy = {
      unitFees: { packaging: 0.5, shipping: 2 },
      platforms: { 视频号: { insurancePerUnit: 0.3, techFeeRate: 0.006 } },
    }
    const config = normalizeConfig(legacy)
    expect(config).not.toHaveProperty('unitFees')
    expect(config.platforms['快手'].packaging).toEqual(fee('unit', 0.5))
    expect(config.platforms['快手'].shipping).toEqual(fee('unit', 2))
    expect(config.platforms['快手'].insurance).toEqual(fee('unit', 0))
    expect(config.platforms['视频号'].insurance).toEqual(fee('unit', 0.3))
    expect(config.platforms['视频号'].techFeeRate).toBe(0.006)
  })

  it('拒绝非法费率与非法计算方式', () => {
    expect(() => normalizeConfig({ platforms: { 快手: { techFeeRate: 2 } } })).toThrow()
    expect(() => normalizeConfig({ unitFees: { packaging: -1 } })).toThrow()
    expect(() => normalizeConfig({ platforms: { 快手: { packaging: { perUnit: -1 } } } })).toThrow()
    expect(() =>
      normalizeConfig({ platforms: { 快手: { packaging: { mode: 'unknown', perUnit: 1 } } } }),
    ).toThrow()
  })

  it('extraPlatforms 会补进平台表', () => {
    const config = normalizeConfig({}, ['未识别'])
    expect(config.platforms['未识别']).toBeDefined()
  })

  it('字段排序默认值与自定义顺序', () => {
    const defaulted = normalizeConfig({})
    expect(defaulted.tableFieldOrder).toEqual(DEFAULT_PNL_FIELD_ORDER)

    const custom = normalizeConfig({ tableFieldOrder: ['grossProfit', 'unknown', 'settledSales'] })
    expect(custom.tableFieldOrder[0]).toBe('grossProfit')
    expect(custom.tableFieldOrder[1]).toBe('settledSales')
    expect(custom.tableFieldOrder).not.toContain('unknown')
    expect(custom.tableFieldOrder).toHaveLength(DEFAULT_PNL_FIELD_ORDER.length)
  })

  it('默认配置可再次规范化（幂等）', () => {
    const first: Config = defaultConfig(['抖音'])
    const second = normalizeConfig(JSON.parse(JSON.stringify(first)))
    expect(second).toEqual(first)
  })
})
