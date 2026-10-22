/** 数值/文本解析与平台名归一化工具 */

const EMPTY_TOKENS = new Set(['', '-', '--', '—', '/', 'N/A', 'n/a', '#N/A', '#REF!', '#VALUE!', 'null', 'NULL'])

export function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

/** 解析金额：支持 ¥/￥、千分位、全角数字、括号负数、空值与错误值 */
export function parseMoney(raw: string): number {
  if (!raw) return 0
  let text = String(raw)
    .replace(/[¥￥,\s　]/g, '')
    .replace(/元/g, '')
    .replace(/[％%]/g, '')
    // 全角数字/符号 → 半角
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, '.')
    .replace(/[－—–]/g, '-')
  if (!text) return 0
  if (EMPTY_TOKENS.has(text)) return 0
  let negative = false
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }
  const value = Number(text)
  if (!Number.isFinite(value)) return 0
  return negative ? -value : value
}

/** 原始金额是否为可解析数字（用于统计异常行） */
export function isParsableMoney(raw: string): boolean {
  const text = String(raw ?? '').trim()
  if (!text) return true
  if (EMPTY_TOKENS.has(text)) return true
  const cleaned = text.replace(/[¥￥,\s　%％]/g, '').replace(/元/g, '')
  return cleaned !== '' && Number.isFinite(Number(cleaned))
}

export function parseQty(raw: string): number {
  const value = parseMoney(raw)
  return Number.isFinite(value) ? value : 0
}

const PLATFORM_ALIASES: Array<[string, string]> = [
  ['微信视频号', '视频号'],
  ['视频号', '视频号'],
  ['快手小店', '快手'],
  ['快手', '快手'],
  ['抖音小店', '抖音'],
  ['抖音', '抖音'],
  ['天猫', '天猫'],
  ['淘宝', '天猫'],
  ['拼多多', '拼多多'],
  ['京东', '京东'],
  ['小红书', '小红书'],
]

export function normalizePlatform(raw: string): string {
  const text = toText(raw)
  if (!text) return ''
  for (const [alias, canonical] of PLATFORM_ALIASES) {
    if (text === alias) return canonical
  }
  for (const [alias, canonical] of PLATFORM_ALIASES) {
    if (text.includes(alias)) return canonical
  }
  return text
}

/** 从文件名推断平台（文件名包含平台信息） */
export function platformFromFileName(fileName: string): string {
  for (const [alias, canonical] of PLATFORM_ALIASES) {
    if (fileName.includes(alias)) return canonical
  }
  return ''
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
