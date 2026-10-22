import path from 'node:path'
import type { Readable } from 'node:stream'
import { findSheet, openWorkbook } from './zip'
import { loadSharedStrings } from './sharedStrings'
import { streamSheetRows, type SheetRow } from './sheetStream'
import { parseMoney, toText } from '../util/numbers'

export interface CostTableData {
  /** 商品编码 → 成本单价 */
  prices: Record<string, number>
  /** 商品编码 → 商品名 */
  names: Record<string, string>
  /** 商品编码 → 款式编码 */
  styles: Record<string, string>
  /** 商品名 → 成本单价列表（用于缺失 SKU 的建议价） */
  namePrices: Record<string, number[]>
  /** 单件页：商品名 → 单价 */
  unitPrices: Record<string, number>
  /** 新品页：商品名 → 增加额 */
  additions: Record<string, number>
  costColumn: string
  costColumnHeader: string
  rows: number
  warnings: string[]
  sourceFile: string
}

const EMPTY: CostTableData = {
  prices: {},
  names: {},
  styles: {},
  namePrices: {},
  unitPrices: {},
  additions: {},
  costColumn: 'F',
  costColumnHeader: '',
  rows: 0,
  warnings: [],
  sourceFile: '',
}

function columnIndex(letter: string): number {
  let result = 0
  for (const char of letter) result = result * 26 + (char.charCodeAt(0) - 64)
  return result
}

function letterFromCells(cells: Record<string, string>, predicate: (value: string) => boolean): string[] {
  return Object.keys(cells).filter((letter) => predicate(toText(cells[letter])))
}

/** 读取主成本表：Sheet1 / 商品编码 / 商品名 / 成本列（最后一个匹配「月|成本|单价」的列） */
export async function readCostTable(filePath: string): Promise<CostTableData> {
  const workbook = await openWorkbook(filePath)
  const sheet = await findSheet(workbook, 'Sheet1')
  const sharedEntry = workbook.entry('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry ? await loadSharedStrings(sharedEntry.stream()) : []

  const result: CostTableData = { ...EMPTY, warnings: [], sourceFile: path.basename(filePath) }
  const duplicateSkus = new Set<string>()
  let headerRow = 0
  let priceLetter = 'F'
  let fatal: Error | null = null
  let streamRef: Readable | null = null

  const entry = workbook.entry(sheet.path)
  if (!entry) throw new Error(`未找到 Sheet XML：${sheet.path}`)

  const handleRow = (row: SheetRow) => {
    if (!headerRow) {
      const skuHeader = toText(row.cells['B'] ?? '')
      const nameHeader = toText(row.cells['C'] ?? '')
      if (skuHeader === '商品编码' && nameHeader === '商品名') {
        headerRow = row.row
        const candidates = letterFromCells(row.cells, (value) => /月|成本|单价/.test(value))
        if (candidates.length) {
          candidates.sort((a, b) => columnIndex(b) - columnIndex(a))
          priceLetter = candidates[0]
        }
        result.costColumn = priceLetter
        result.costColumnHeader = toText(row.cells[priceLetter] ?? '')
        return
      }
      if (row.row > 8) {
        fatal = new Error('成本表未找到表头（期望 B 列「商品编码」、C 列「商品名」）')
        streamRef?.destroy(fatal)
      }
      return
    }

    const sku = toText(row.cells['B'] ?? '')
    if (!sku) return
    const name = toText(row.cells['C'] ?? '')
    const style = toText(row.cells['A'] ?? '')
    const price = parseMoney(row.cells[priceLetter] ?? '')
    result.rows += 1
    if (result.prices[sku] === undefined) {
      result.prices[sku] = price
      result.names[sku] = name
      result.styles[sku] = style
      if (name) {
        ;(result.namePrices[name] ??= []).push(price)
      }
    } else {
      duplicateSkus.add(sku)
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
  if (!headerRow) throw new Error('成本表未找到表头（期望 B 列「商品编码」、C 列「商品名」）')
  if (duplicateSkus.size) {
    result.warnings.push(`成本表有 ${duplicateSkus.size} 个重复商品编码，已保留首次出现的成本`)
  }

  // 辅助页：单件（商品名→单价）、新品（商品名→增加额）
  await readNameSheet(workbook, sharedStrings, '单件', result.unitPrices, result.warnings)
  await readNameSheet(workbook, sharedStrings, '新品', result.additions, result.warnings)

  return result
}

async function readNameSheet(
  workbook: Awaited<ReturnType<typeof openWorkbook>>,
  sharedStrings: string[],
  sheetName: string,
  target: Record<string, number>,
  warnings: string[],
): Promise<void> {
  const sheets = await (await import('./zip')).listSheets(workbook)
  const found = sheets.find((sheet) => sheet.name.trim() === sheetName)
  if (!found) return
  const entry = workbook.entry(found.path)
  if (!entry) return
  let headerRow = 0
  try {
    await streamSheetRows(entry.stream(), {
      sharedStrings,
      columns: new Set(['A', 'B']),
      onRow: (row) => {
        if (!headerRow) {
          if (row.row === 1) headerRow = 1
          return
        }
        const name = toText(row.cells['A'] ?? '')
        const value = parseMoney(row.cells['B'] ?? '')
        if (name && target[name] === undefined) target[name] = value
      },
    })
  } catch (error) {
    warnings.push(`读取「${sheetName}」页失败：${(error as Error).message}`)
  }
}
