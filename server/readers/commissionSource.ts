import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { listSheets, openWorkbook, readEntryText } from './zip'
import { loadSharedStrings } from './sharedStrings'
import { streamSheetRows, type SheetRow } from './sheetStream'
import { normalizePlatform, parseMoney, platformFromFileName, toText } from '../util/numbers'

export type CommissionMode = 'line' | 'order'

export interface CommissionRecord {
  /** 平台（从文件/目录名识别） */
  platform: string
  orderNo: string
  /** line 模式：订单明细行的 SKU；order 模式为空 */
  sku: string
  amount: number
  mode: CommissionMode
  sourceFile: string
  sheet: string
}

export interface LeaderFeeRecord {
  platform: string
  orderNo: string
  amount: number
  sourceFile: string
  sheet: string
}

export interface CommissionFileData {
  sourceFile: string
  sheets: string[]
  ignoredSheets: string[]
  rows: number
  records: CommissionRecord[]
  leaderRecords: LeaderFeeRecord[]
  warnings: string[]
}

const COMMISSION_DIR_PATTERN = /商务订单|商务订单表/

async function walkXlsx(dir: string): Promise<string[]> {
  const result: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.includes('退样')) continue
      result.push(...(await walkXlsx(fullPath)))
    } else if (entry.isFile() && /\.xlsx$/i.test(entry.name) && !entry.name.startsWith('~$')) {
      result.push(fullPath)
    }
  }
  return result
}

/** 在源文件目录下寻找「商务订单」目录（如 9月份商务订单），返回其中所有 xlsx */
export async function discoverCommissionFiles(excelDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(excelDir, { withFileTypes: true })
  } catch {
    return []
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory() && COMMISSION_DIR_PATTERN.test(entry.name))
    .map((entry) => path.join(excelDir, entry.name))
  const files: string[] = []
  for (const dir of dirs) files.push(...(await walkXlsx(dir)))
  // 顶层（更浅）的汇总文件优先：排序后再做去重，保证覆盖且不重复
  return files.sort((a, b) => {
    const depthA = a.split(path.sep).length
    const depthB = b.split(path.sep).length
    return depthA - depthB || a.localeCompare(b)
  })
}

export function platformFromPath(relativePath: string): string {
  const text = relativePath.replace(/\\/g, '/')
  const fromFile = platformFromFileName(text)
  if (fromFile) return fromFile
  if (text.includes('精选联盟')) return '抖音'
  if (text.includes('淘宝')) return '天猫'
  return ''
}

interface HeaderMap {
  headerRow: number
  columns: Map<string, string>
}

function buildHeaderMap(row: SheetRow): HeaderMap {
  const columns = new Map<string, string>()
  for (const [letter, value] of Object.entries(row.cells)) {
    const text = toText(value)
    if (text) columns.set(text, letter)
  }
  return { headerRow: row.row, columns }
}

function findColumn(map: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const letter = map.get(name)
    if (letter) return letter
  }
  return ''
}

type SheetKind = 'commission-order' | 'commission-line' | 'leader-fee' | 'order-detail' | 'unknown'

interface SheetPlan {
  kind: SheetKind
  platform: string
  orderCol: string
  amountCol: string
  altAmountCol: string
  skuCol: string
}

function planSheet(header: Map<string, string>, platform: string): SheetPlan | null {
  const orderIdCol = findColumn(header, ['订单id', '订单ID'])
  const estimateCommissionCol = findColumn(header, ['预估佣金支出'])
  const actualCommissionCol = findColumn(header, ['实际佣金支出'])
  const leaderFeeCol = findColumn(header, ['预估服务费收入', '实际服务费收入'])
  const orderNoCol = findColumn(header, ['订单号', '子订单编号', '主订单编号'])
  const ksCommissionCol = findColumn(header, ['预估推广佣金'])
  const vsCommissionCol = findColumn(header, ['带货费用'])

  if (orderIdCol && (estimateCommissionCol || actualCommissionCol)) {
    return {
      kind: 'commission-order',
      platform,
      orderCol: orderIdCol,
      amountCol: estimateCommissionCol || actualCommissionCol,
      altAmountCol: actualCommissionCol && estimateCommissionCol ? actualCommissionCol : '',
      skuCol: '',
    }
  }
  if (orderIdCol && leaderFeeCol) {
    return {
      kind: 'leader-fee',
      platform,
      orderCol: orderIdCol,
      amountCol: leaderFeeCol,
      altAmountCol: '',
      skuCol: '',
    }
  }
  if (orderNoCol && ksCommissionCol) {
    return {
      kind: 'commission-line',
      platform,
      orderCol: orderNoCol,
      amountCol: ksCommissionCol,
      altAmountCol: '',
      skuCol: findColumn(header, ['SKU编码', '商家SKU编码', '商家编码']),
    }
  }
  if (orderNoCol && vsCommissionCol) {
    return {
      kind: 'commission-line',
      platform,
      orderCol: orderNoCol,
      amountCol: vsCommissionCol,
      altAmountCol: '',
      skuCol: findColumn(header, ['SKU编码(自定义)', 'SKU编码', '商品编码(自定义)']),
    }
  }
  if (orderNoCol) return { kind: 'order-detail', platform, orderCol: orderNoCol, amountCol: '', altAmountCol: '', skuCol: '' }
  return null
}

/**
 * 读取单个商务订单文件：自动识别
 * ① 精选联盟「达人订单」（订单级佣金）② 快手/视频号订单明细中的佣金列（行级佣金）
 * ③ 团长订单（团长服务费，仅记录不计入达人佣金）④ 纯订单明细（忽略）
 */
export async function readCommissionFile(filePath: string, baseDir?: string): Promise<CommissionFileData> {
  const relativePath = path.relative(baseDir ?? process.cwd(), filePath)
  const platform = normalizePlatform(platformFromPath(relativePath))
  const sourceFile = path.basename(filePath)
  const result: CommissionFileData = {
    sourceFile,
    sheets: [],
    ignoredSheets: [],
    rows: 0,
    records: [],
    leaderRecords: [],
    warnings: [],
  }

  const workbook = await openWorkbook(filePath)
  const sheets = await listSheets(workbook)
  const sharedEntry = workbook.entry('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry ? await loadSharedStrings(sharedEntry.stream()) : []

  let header: HeaderMap | null = null
  let plan: SheetPlan | null = null

  for (const sheet of sheets) {
    const entry = workbook.entry(sheet.path)
    if (!entry) continue
    header = null
    plan = null
    let fatal: Error | null = null
    try {
      await streamSheetRows(entry.stream(), {
        sharedStrings,
        onRow: (row) => {
          const nonEmpty = Object.keys(row.cells).length
          if (nonEmpty === 0) return
          if (!header) {
            if (nonEmpty < 3) return
            header = buildHeaderMap(row)
            plan = planSheet(header.columns, platform)
            if (plan && plan.kind !== 'order-detail' && plan.kind !== 'unknown') {
              result.sheets.push(sheet.name)
            } else {
              result.ignoredSheets.push(sheet.name)
            }
            return
          }
          if (!plan || plan.kind === 'order-detail' || plan.kind === 'unknown') return
          const cell = (letter: string) => (letter ? (row.cells[letter] ?? '') : '')
          const orderNo = toText(cell(plan.orderCol))
          if (!orderNo) return
          let amount = parseMoney(cell(plan.amountCol))
          if (amount === 0 && plan.altAmountCol) amount = parseMoney(cell(plan.altAmountCol))
          result.rows += 1
          if (plan.kind === 'leader-fee') {
            result.leaderRecords.push({
              platform,
              orderNo,
              amount,
              sourceFile,
              sheet: sheet.name,
            })
            return
          }
          const sku = plan.skuCol ? toText(cell(plan.skuCol)) : ''
          if (amount <= 0) return
          result.records.push({
            platform,
            orderNo,
            sku,
            amount,
            mode: plan.kind === 'commission-order' ? 'order' : 'line',
            sourceFile,
            sheet: sheet.name,
          })
        },
      })
    } catch (error) {
      if (fatal) throw fatal
      result.warnings.push(`「${sheet.name}」页读取失败：${(error as Error).message}`)
    }
  }

  if (!platform) {
    result.warnings.push('未能从文件名/路径识别平台，佣金记录将无法匹配订单')
  }
  return result
}
