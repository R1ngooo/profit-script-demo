const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const intFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `¥${moneyFormatter.format(value)}`
}

export function fmtMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `¥${intFormatter.format(value)}`
}

export function fmtSignedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const prefix = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${prefix}¥${moneyFormatter.format(Math.abs(value))}`
}

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value)
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return intFormatter.format(value)
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e8) return `¥${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `¥${(value / 1e4).toFixed(2)}万`
  return `¥${moneyFormatter.format(value)}`
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`
}

export function fmtSeconds(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '0s'
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function toneOf(value: number | null | undefined): 'pos' | 'neg' | 'zero' {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'zero'
  return value > 0 ? 'pos' : 'neg'
}

export function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let result = value
  if (min !== undefined) result = Math.max(min, result)
  if (max !== undefined) result = Math.min(max, result)
  return result
}
