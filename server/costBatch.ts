import ExcelJS from 'exceljs'
import { toText } from './util/numbers'

/** 批量补录时只关心 SKU 编码与成本价，其余列（款式/平台/备注等）忽略 */
export interface CostImportRow {
  sku: string
  productName: string
  cost: number
}

export interface CostImportIgnored {
  reason: 'emptySku' | 'invalidCost' | 'missingCost'
  sku: string
  value: string
}

export interface CostImportParseResult {
  rows: CostImportRow[]
  ignored: CostImportIgnored[]
  warnings: string[]
  sheets: string[]
  headerRow: number
  sheetName: string
}

export interface CostTemplateRow {
  sku: string
  productName: string
  suggestion: number | null
  platforms: string[]
  settledQty: number
}

const SKU_HEADERS = new Set([
  '商品编码',
  '商品编号',
  'sku',
  'sku编码',
  '商家编码',
  '商家sku编码',
  '店铺商品编码',
  '规格编码',
  '货号',
  '编码',
  '商品id',
])

const NAME_HEADERS = new Set(['商品名', '商品名称', '品名', '名称', '宝贝名称', '标题'])

const IGNORED_TOKENS = new Set(['', '-', '--', '—', '/', 'N/A', 'n/a', '#N/A', '#REF!', '#VALUE!', 'null', 'NULL'])

function normalizeHeader(text: string): string {
  return toText(text).toLowerCase().replace(/[\s　]/g, '').replace(/[（(].*?[)）]/g, '')
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const record = value as {
      richText?: Array<{ text: string }>
      text?: string
      result?: unknown
      hyperlink?: string
      formula?: string
    }
    if (record.richText) return record.richText.map((item) => item.text).join('').trim()
    if (record.text !== undefined) return String(record.text).trim()
    if (record.result !== undefined) return String(record.result).trim()
    if (record.hyperlink) return record.hyperlink.trim()
  }
  return String(value).trim()
}

function parseCostCell(raw: string): number | null {
  const text = raw
    .replace(/[¥￥,，\s　]/g, '')
    .replace(/元/g, '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  if (IGNORED_TOKENS.has(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

function costHeaderScore(header: string): number {
  if (!header) return -1
  if (/建议|参考|售价|原价|市场价|吊牌|零售|利润|毛利/.test(header)) return -1
  if (header.includes('补录')) return 60
  if (header.includes('成本')) return 50
  if (header.includes('进价') || header.includes('采购')) return 40
  if (header === '单价' || header === '价格') return 20
  return -1
}

function skuHeaderScore(header: string): number {
  if (!header) return -1
  if (header === '商品编码') return 50
  if (header === '商品编号') return 45
  if (header === 'sku' || header === 'sku编码') return 40
  if (header.includes('商家') && header.includes('编码')) return 35
  if (header.includes('编码') && !header.includes('款式')) return 20
  if (SKU_HEADERS.has(header)) return 15
  return -1
}

interface HeaderMap {
  headerRow: number
  skuCol: number
  nameCol: number
  costCol: number
}

function findHeader(worksheet: ExcelJS.Worksheet): HeaderMap | null {
  const maxScan = Math.min(worksheet.rowCount, 20)
  for (let rowNumber = 1; rowNumber <= maxScan; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    let skuCol = 0
    let skuScore = 0
    let nameCol = 0
    const costCandidates: Array<{ col: number; score: number }> = []
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = normalizeHeader(cellText(cell.value))
      const sku = skuHeaderScore(header)
      if (sku > skuScore) {
        skuScore = sku
        skuCol = colNumber
      }
      if (!nameCol && NAME_HEADERS.has(header)) nameCol = colNumber
      const costScore = costHeaderScore(header)
      if (costScore > 0) costCandidates.push({ col: colNumber, score: costScore })
    })
    if (!skuCol || !costCandidates.length) continue
    costCandidates.sort((a, b) => b.score - a.score || a.col - b.col)
    return { headerRow: rowNumber, skuCol, nameCol, costCol: costCandidates[0].col }
  }
  return null
}

/** 解析批量补录工作簿：自动定位表头，读取「SKU 编码 + 成本价」，其余列忽略 */
export async function parseCostWorkbook(buffer: Buffer): Promise<CostImportParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const rows: CostImportRow[] = []
  const ignored: CostImportIgnored[] = []
  const warnings: string[] = []
  const sheets: string[] = []
  const seen = new Map<string, CostImportRow>()
  const sheetRowCounts = new Map<string, number>()
  let duplicates = 0
  let firstHeader: HeaderMap | null = null
  let firstSheetName = ''
  let parsedSheets = 0

  workbook.eachSheet((worksheet) => {
    const header = findHeader(worksheet)
    if (!header) return
    parsedSheets += 1
    sheets.push(worksheet.name)
    if (!firstHeader) {
      firstHeader = header
      firstSheetName = worksheet.name
    }
    for (let rowNumber = header.headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber)
      const sku = cellText(row.getCell(header.skuCol).value).replace(/\s+/g, '')
      const rawCost = cellText(row.getCell(header.costCol).value)
      const name = header.nameCol ? cellText(row.getCell(header.nameCol).value) : ''
      if (!sku && !rawCost) continue
      if (!sku) {
        ignored.push({ reason: 'emptySku', sku: '', value: rawCost })
        continue
      }
      if (IGNORED_TOKENS.has(normalizeHeader(rawCost))) {
        ignored.push({ reason: 'invalidCost', sku, value: rawCost })
        continue
      }
      const cost = parseCostCell(rawCost)
      if (cost === null) {
        ignored.push({ reason: 'invalidCost', sku, value: rawCost })
        continue
      }
      const existing = seen.get(sku)
      if (existing) duplicates += 1
      const parsedRow: CostImportRow = { sku, productName: name, cost }
      seen.set(sku, parsedRow)
      sheetRowCounts.set(worksheet.name, (sheetRowCounts.get(worksheet.name) ?? 0) + 1)
    }
  })

  if (!parsedSheets) {
    throw new Error('未找到有效表头：至少需要包含「商品编码」（或 SKU）与「成本价」两列，且表头在前 20 行内')
  }
  if (duplicates) warnings.push(`有 ${duplicates} 行 SKU 重复，已取最后一行成本价`)
  for (const [sheet, count] of sheetRowCounts) {
    if (count === 0) warnings.push(`工作表「${sheet}」未读取到数据`)
  }
  if (ignored.length) {
    const invalid = ignored.filter((item) => item.reason === 'invalidCost').length
    if (invalid) warnings.push(`有 ${invalid} 行成本价为空或不是有效非负数字，已忽略`)
  }
  return {
    rows: [...seen.values()],
    ignored: ignored.slice(0, 200),
    warnings,
    sheets,
    headerRow: (firstHeader as HeaderMap | null)?.headerRow ?? 0,
    sheetName: firstSheetName,
  }
}

/** 生成批量补录模板：关键列与成本表一致（款式编码/商品编码/商品名/成本价），其余列为参考信息 */
export async function buildCostTemplateWorkbook(
  rows: CostTemplateRow[],
  costHeader: string,
  period: string | null,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'profit-script'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('成本补录')
  const costColumnLabel = costHeader ? `成本价（原表列：${costHeader}）` : '成本价'
  const header = sheet.addRow([
    '款式编码',
    '商品编码',
    '商品名',
    costColumnLabel,
    '建议成本价（客单价33%，仅供参考）',
    '平台',
    '结算件数',
    '备注',
  ])
  header.font = { bold: true }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.height = 22
  sheet.columns = [
    { width: 14 },
    { width: 28 },
    { width: 34 },
    { width: 14 },
    { width: 20 },
    { width: 18 },
    { width: 12 },
    { width: 30 },
  ]
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: 'H1' }

  for (const row of rows) {
    const added = sheet.addRow([
      '',
      row.sku,
      row.productName,
      null,
      row.suggestion,
      row.platforms.join('、'),
      row.settledQty,
      '填 D 列成本价后上传，其他列可忽略',
    ])
    added.getCell(4).numFmt = '#,##0.00'
    added.getCell(5).numFmt = '#,##0.00'
  }

  const guide = workbook.addWorksheet('填写说明')
  guide.columns = [{ width: 96 }]
  guide.addRow(['缺失成本批量补录说明']).font = { bold: true, size: 13 }
  const lines = [
    `1. 本模板由当前缺失成本的 SKU 生成${period ? `（周期 ${period}）` : ''}，共 ${rows.length} 个 SKU。`,
    '2. 只需在 D 列「成本价」填写每个 SKU 的单价（元），保存为 .xlsx 后回到面板 Ⅲ 点「Excel 批量补录」上传。',
    '3. 必填列：商品编码（SKU）、成本价；商品名、建议成本价、平台、结算件数、备注等列仅作参考，可忽略或删除。',
    '4. 支持直接上传按原成本表格式整理的文件，系统会自动识别表头（商品编码/商品名/成本价等列名），多余列会被忽略。',
    '5. 导入后先进入当前参数的「草稿」并实时预览毛利，确认无误后需点击面板右上角「提交并保存」才会写入配置。',
  ]
  for (const line of lines) guide.addRow([line])

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}
