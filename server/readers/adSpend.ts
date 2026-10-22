import path from 'node:path'
import type { Readable } from 'node:stream'
import { findSheet, openWorkbook } from './zip'
import { loadSharedStrings } from './sharedStrings'
import { streamSheetRows, type SheetRow } from './sheetStream'
import { normalizePlatform, parseMoney, toText } from '../util/numbers'

export interface AdSpendData {
  /** 平台 → 消耗合计 */
  byPlatform: Record<string, number>
  /** 平台 → 产品 → 消耗合计 */
  byProduct: Record<string, Record<string, number>>
  rows: number
  warnings: string[]
  sourceFile: string
}

/** 读取月消耗表「汇总」页：L=电商平台，H=消耗，F=产品 */
export async function readAdSpend(filePath: string): Promise<AdSpendData> {
  const workbook = await openWorkbook(filePath)
  const sheet = await findSheet(workbook, '汇总')
  const sharedEntry = workbook.entry('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry ? await loadSharedStrings(sharedEntry.stream()) : []

  const result: AdSpendData = { byPlatform: {}, byProduct: {}, rows: 0, warnings: [], sourceFile: path.basename(filePath) }
  let headerRow = 0
  let fatal: Error | null = null
  let streamRef: Readable | null = null

  const entry = workbook.entry(sheet.path)
  if (!entry) throw new Error(`未找到 Sheet XML：${sheet.path}`)

  const handleRow = (row: SheetRow) => {
    if (!headerRow) {
      if (toText(row.cells['L'] ?? '') === '电商平台' && toText(row.cells['H'] ?? '') === '消耗') {
        headerRow = row.row
        return
      }
      if (row.row > 8) {
        fatal = new Error('月消耗表「汇总」页表头异常（期望 L 列「电商平台」、H 列「消耗」）')
        streamRef?.destroy(fatal)
      }
      return
    }

    const rawPlatform = toText(row.cells['L'] ?? '')
    if (!rawPlatform) return
    const platform = normalizePlatform(rawPlatform)
    const spend = parseMoney(row.cells['H'] ?? '')
    const product = toText(row.cells['F'] ?? '')
    result.rows += 1
    result.byPlatform[platform] = (result.byPlatform[platform] ?? 0) + spend
    if (product) {
      const bucket = (result.byProduct[platform] ??= {})
      bucket[product] = (bucket[product] ?? 0) + spend
    }
  }

  const source = entry.stream()
  streamRef = source
  try {
    await streamSheetRows(source, { sharedStrings, onRow: handleRow })
  } catch (error) {
    if (fatal) throw fatal
    throw error
  }
  if (fatal) throw fatal
  if (!headerRow) throw new Error('月消耗表「汇总」页表头异常（期望 L 列「电商平台」、H 列「消耗」）')

  return result
}
