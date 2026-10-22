import { describe, expect, it } from 'vitest'
import {
  isParsableMoney,
  normalizePlatform,
  parseMoney,
  parseQty,
  platformFromFileName,
  safeDivide,
} from '../../server/util/numbers'

describe('parseMoney', () => {
  it('解析常见金额格式', () => {
    expect(parseMoney('¥39.9')).toBe(39.9)
    expect(parseMoney('1,234.56')).toBe(1234.56)
    expect(parseMoney(' 59.90 ')).toBe(59.9)
    expect(parseMoney('￥88')).toBe(88)
    expect(parseMoney('（100）')).toBe(0)
    expect(parseMoney('(100)')).toBe(-100)
  })

  it('空值与错误值按 0 处理', () => {
    for (const value of ['', '-', '#N/A', 'N/A', '—', 'null']) {
      expect(parseMoney(value)).toBe(0)
    }
  })

  it('全角数字可解析', () => {
    expect(parseMoney('１２３．４５')).toBe(123.45)
  })

  it('isParsableMoney 识别异常值', () => {
    expect(isParsableMoney('39.9')).toBe(true)
    expect(isParsableMoney('')).toBe(true)
    expect(isParsableMoney('-')).toBe(true)
    expect(isParsableMoney('abc')).toBe(false)
  })

  it('parseQty 复用金额解析', () => {
    expect(parseQty('2')).toBe(2)
    expect(parseQty('')).toBe(0)
  })
})

describe('平台归一化', () => {
  it('别名归一', () => {
    expect(normalizePlatform('微信视频号')).toBe('视频号')
    expect(normalizePlatform('快手小店')).toBe('快手')
    expect(normalizePlatform('抖音')).toBe('抖音')
    expect(normalizePlatform('  ')).toBe('')
  })

  it('从文件名识别平台', () => {
    expect(platformFromFileName('2026.9月快手订单处理-o10.11.xlsx')).toBe('快手')
    expect(platformFromFileName('2026.9月视频号订单处理-o10.11.xlsx')).toBe('视频号')
    expect(platformFromFileName('未知文件.xlsx')).toBe('')
  })

  it('safeDivide 处理除零', () => {
    expect(safeDivide(1, 0)).toBeNull()
    expect(safeDivide(1, 4)).toBe(0.25)
  })
})
