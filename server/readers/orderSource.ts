import path from 'node:path'
import type { Readable } from 'node:stream'
import type { OrderRow } from '../../shared/types'
import { listSheets, openWorkbook, type SheetLocation } from './zip'
import { loadSharedStrings } from './sharedStrings'
import { streamSheetRows, type SheetRow } from './sheetStream'
import { isParsableMoney, parseMoney, parseQty, platformFromFileName, toText } from '../util/numbers'

type OrderField =
  | 'orderNo'
  | 'subOrderNo'
  | 'orderStatus'
  | 'afterSale'
  | 'sku'
  | 'productName'
  | 'productCode'
  | 'qty'
  | 'sales'
  | 'shop'
  | 'createdAt'
  | 'testFlag'

type ColumnMap = Record<OrderField, string>

export interface OrderSchema {
  platform: string
  /** 表名（同一平台可能存在新旧多种导出格式，按表头自动匹配） */
  variant: string
  sheetName: string
  columns: ColumnMap
  headers: Record<OrderField, string>
}

/**
 * 每个平台可配置多套格式：优先新版（10 月导出：毛利用+提成用 / 提成+毛利用 等），
 * 旧版作为兼容回退。运行时会按实际工作簿的表头自动选择匹配度最高的一套。
 */
const ORDER_SCHEMAS: Record<string, OrderSchema[]> = {
  快手: [
    {
      platform: '快手',
      variant: '2026.10+',
      sheetName: '毛利用+提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'H',
        afterSale: 'W',
        sku: 'AE',
        productName: 'AF',
        productCode: 'AC',
        qty: 'Q',
        sales: 'AH',
        shop: 'BX',
        createdAt: 'D',
        testFlag: 'AL',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: 'SKU编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '成交数量',
        sales: '销售金额',
        shop: '店铺名称',
        createdAt: '订单创建时间',
        testFlag: '刷单',
      },
    },
    {
      platform: '快手',
      variant: '旧版',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'H',
        afterSale: 'W',
        sku: 'AE',
        productName: 'AF',
        productCode: 'AC',
        qty: 'Q',
        sales: 'AI',
        shop: 'BY',
        createdAt: 'D',
        testFlag: 'AM',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: 'SKU编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '成交数量',
        sales: '销售金额',
        shop: '店铺名称',
        createdAt: '订单创建时间',
        testFlag: '刷单',
      },
    },
  ],
  视频号: [
    {
      platform: '视频号',
      variant: '2026.10+',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'G',
        afterSale: 'BZ',
        sku: 'BD',
        productName: 'BE',
        productCode: 'BC',
        qty: 'BK',
        sales: 'BN',
        shop: 'CB',
        createdAt: 'B',
        testFlag: '',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '商品售后',
        sku: 'SKU编码(自定义)',
        productName: '商品名称',
        productCode: '商品编码(自定义)',
        qty: '商品数量',
        sales: '销售金额',
        shop: '店铺名称',
        createdAt: '订单下单时间',
        testFlag: '',
      },
    },
    {
      platform: '视频号',
      variant: '旧版',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'G',
        afterSale: 'BZ',
        sku: 'BB',
        productName: 'BC',
        productCode: 'BA',
        qty: 'BI',
        sales: 'BL',
        shop: 'CB',
        createdAt: 'B',
        testFlag: '',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '商品售后',
        sku: 'SKU编码(自定义)',
        productName: '商品名称',
        productCode: '商品编码(自定义)',
        qty: '商品数量',
        sales: '销售金额',
        shop: '店铺名称',
        createdAt: '订单下单时间',
        testFlag: '',
      },
    },
  ],
  天猫: [
    {
      platform: '天猫',
      variant: '2026.10+',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'J',
        afterSale: 'W',
        sku: 'K',
        productName: 'L',
        productCode: 'AB',
        qty: 'E',
        sales: 'S',
        shop: 'AM',
        createdAt: 'Y',
        testFlag: '',
      },
      headers: {
        orderNo: '子订单编号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '退款状态',
        sku: '商家编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '购买数量',
        sales: '报表买家实付金额',
        shop: '店铺',
        createdAt: '订单创建时间',
        testFlag: '',
      },
    },
    {
      platform: '天猫',
      variant: '旧版',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'J',
        afterSale: 'X',
        sku: 'K',
        productName: 'L',
        productCode: 'AC',
        qty: 'E',
        sales: 'T',
        shop: 'AN',
        createdAt: 'Z',
        testFlag: '',
      },
      headers: {
        orderNo: '子订单编号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '退款状态',
        sku: '商家编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '购买数量',
        sales: '报表买家实付金额',
        shop: '店铺',
        createdAt: '订单创建时间',
        testFlag: '',
      },
    },
  ],
  京东: [
    {
      platform: '京东',
      variant: '2026.10+',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'L',
        afterSale: 'AD',
        sku: 'R',
        productName: 'S',
        productCode: 'B',
        qty: 'D',
        sales: 'V',
        shop: '',
        createdAt: 'F',
        testFlag: 'AA',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '平台售后状态',
        sku: '商家SKUID',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '订购数量',
        sales: '销售金额',
        shop: '',
        createdAt: '下单时间',
        testFlag: '刷单',
      },
    },
    {
      platform: '京东',
      variant: '旧版',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'L',
        afterSale: 'AC',
        sku: 'P',
        productName: 'Q',
        productCode: 'B',
        qty: 'D',
        sales: 'T',
        shop: '',
        createdAt: 'F',
        testFlag: 'Z',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '平台售后状态',
        sku: '商家SKUID',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '订购数量',
        sales: '销售金额',
        shop: '',
        createdAt: '下单时间',
        testFlag: '刷单',
      },
    },
  ],
  抖音: [
    {
      platform: '抖音',
      variant: '2026.10+',
      sheetName: '毛利用提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: 'B',
        orderStatus: 'AW',
        afterSale: 'BD',
        sku: 'G',
        productName: 'H',
        productCode: 'F',
        qty: 'E',
        sales: 'J',
        shop: 'BW',
        createdAt: 'AP',
        testFlag: 'Q',
      },
      headers: {
        orderNo: '主订单编号',
        subOrderNo: '子订单编号',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: '商家编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '商品数量',
        sales: '销售金额',
        shop: '店铺',
        createdAt: '订单提交时间',
        testFlag: '是否刷单',
      },
    },
    {
      platform: '抖音',
      variant: '旧版',
      sheetName: '提成用',
      columns: {
        orderNo: 'A',
        subOrderNo: 'B',
        orderStatus: 'AP',
        afterSale: 'AW',
        sku: 'G',
        productName: 'H',
        productCode: 'F',
        qty: 'E',
        sales: 'J',
        shop: 'BP',
        createdAt: 'AI',
        testFlag: 'Q',
      },
      headers: {
        orderNo: '主订单编号',
        subOrderNo: '子订单编号',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: '商家编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: '商品数量',
        sales: '销售金额',
        shop: '店铺',
        createdAt: '订单提交时间',
        testFlag: '是否刷单',
      },
    },
  ],
  拼多多: [
    {
      platform: '拼多多',
      variant: '2026.10+',
      sheetName: '提成用',
      columns: {
        orderNo: 'B',
        subOrderNo: '',
        orderStatus: 'C',
        afterSale: 'R',
        sku: 'G',
        productName: 'H',
        productCode: 'A',
        qty: 'D',
        sales: 'J',
        shop: 'AF',
        createdAt: 'E',
        testFlag: 'L',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: '商家编码-规格维度',
        productName: '产品名称',
        productCode: '商品',
        qty: '商品数量(件)',
        sales: '销售金额',
        shop: '店铺',
        createdAt: '支付时间',
        testFlag: '是否刷单',
      },
    },
    {
      platform: '拼多多',
      variant: '旧版',
      sheetName: '提成用',
      columns: {
        orderNo: 'B',
        subOrderNo: '',
        orderStatus: 'C',
        afterSale: 'S',
        sku: 'G',
        productName: 'H',
        productCode: 'A',
        qty: 'D',
        sales: 'J',
        shop: 'AG',
        createdAt: 'E',
        testFlag: 'M',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: '商家编码-规格维度',
        productName: '产品名称',
        productCode: '商品',
        qty: '商品数量(件)',
        sales: '销售金额',
        shop: '店铺',
        createdAt: '支付时间',
        testFlag: '是否刷单',
      },
    },
  ],
  小红书: [
    {
      platform: '小红书',
      variant: '2026.10+',
      sheetName: '提成+毛利用',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'B',
        afterSale: 'C',
        sku: 'BS',
        productName: 'BT',
        productCode: 'CA',
        qty: 'T',
        sales: 'BW',
        shop: 'CF',
        createdAt: 'AW',
        testFlag: 'BY',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: '商家编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: 'SKU件数',
        sales: '销售金额',
        shop: '店铺',
        createdAt: '订单创建时间',
        testFlag: '刷单',
      },
    },
    {
      platform: '小红书',
      variant: '旧版',
      sheetName: '总表',
      columns: {
        orderNo: 'A',
        subOrderNo: '',
        orderStatus: 'B',
        afterSale: 'C',
        sku: 'U',
        productName: 'V',
        productCode: 'CB',
        qty: 'T',
        sales: 'Y',
        shop: 'CG',
        createdAt: 'BF',
        testFlag: 'AA',
      },
      headers: {
        orderNo: '订单号',
        subOrderNo: '',
        orderStatus: '订单状态',
        afterSale: '售后状态',
        sku: '商家编码',
        productName: '产品名称',
        productCode: '商品ID',
        qty: 'SKU件数',
        sales: '销售金额',
        shop: '店铺',
        createdAt: '订单创建时间',
        testFlag: '刷单',
      },
    },
  ],
}

const EMPTY_STATUS_VALUES = new Set(['#N/A', '#REF!', '#VALUE!', 'N/A', '-', '--', '—', '/', ''])

/** 平台导出的售后/订单状态里常见 #N/A、- 等占位，统一清洗为空 */
function cleanStatus(value: string): string {
  const text = toText(value)
  return EMPTY_STATUS_VALUES.has(text) ? '' : text
}

export interface OrderReadResult {
  platform: string
  sheetName: string
  variant: string
  headerRow: number
  rowsRead: number
  rows: OrderRow[]
  warnings: string[]
}

const CRITICAL_FIELDS: OrderField[] = ['orderNo', 'orderStatus', 'afterSale', 'sku', 'qty', 'sales']

function activeFields(schema: OrderSchema): OrderField[] {
  return (Object.keys(schema.columns) as OrderField[]).filter(
    (field) => schema.columns[field] && schema.headers[field],
  )
}

function matchesHeader(schema: OrderSchema, row: SheetRow): number {
  let matched = 0
  for (const field of activeFields(schema)) {
    const letter = schema.columns[field]
    const expected = schema.headers[field]
    if (toText(row.cells[letter]) === toText(expected)) matched += 1
  }
  return matched
}

interface DetectedSchema {
  schema: OrderSchema
  sheet: SheetLocation
  headerRow: number
  matched: number
}

export async function readOrderFile(filePath: string, platformHint?: string): Promise<OrderReadResult> {
  const platform = platformHint || platformFromFileName(path.basename(filePath))
  const variants = ORDER_SCHEMAS[platform]
  if (!variants) {
    throw new Error(`暂不支持的平台「${platform || path.basename(filePath)}」，目前支持：${Object.keys(ORDER_SCHEMAS).join('、')}`)
  }

  const workbook = await openWorkbook(filePath)
  const sheets = await listSheets(workbook)
  const sheetByName = new Map(sheets.map((sheet) => [sheet.name, sheet]))
  const sharedEntry = workbook.entry('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry ? await loadSharedStrings(sharedEntry.stream()) : []

  /** 只读取前 10 行，用表头匹配度判断该文件属于哪套导出格式 */
  const sniffHeader = async (schema: OrderSchema): Promise<{ headerRow: number; matched: number } | null> => {
    const sheet = sheetByName.get(schema.sheetName)
    const entry = sheet ? workbook.entry(sheet.path) : null
    if (!sheet || !entry) return null
    const columns = new Set<string>(Object.values(schema.columns).filter(Boolean))
    let headerRow = 0
    let matched = 0
    try {
      await streamSheetRows(entry.stream(), {
        sharedStrings,
        columns,
        maxRows: 10,
        onRow: (row) => {
          if (headerRow) return
          const count = matchesHeader(schema, row)
          if (count >= Math.max(6, activeFields(schema).length - 1)) {
            headerRow = row.row
            matched = count
          }
        },
      })
    } catch {
      return null
    }
    return headerRow ? { headerRow, matched } : null
  }

  const detected: DetectedSchema[] = []
  for (const schema of variants) {
    const sheet = sheetByName.get(schema.sheetName)
    if (!sheet) continue
    const header = await sniffHeader(schema)
    if (header) detected.push({ schema, sheet, headerRow: header.headerRow, matched: header.matched })
  }
  detected.sort((a, b) => b.matched - a.matched || variants.indexOf(a.schema) - variants.indexOf(b.schema))
  const chosen = detected[0]
  if (!chosen) {
    throw new Error(
      `未找到匹配的订单表：已尝试 ${variants.map((variant) => `「${variant.sheetName}」`).join('、')}；文件工作表：${
        sheets.map((sheet) => sheet.name).join('、') || '（无）'
      }`,
    )
  }

  const schema = chosen.schema
  const sheet = chosen.sheet
  const columns = new Set<string>(Object.values(schema.columns).filter(Boolean))
  const rows: OrderRow[] = []
  const warnings: string[] = []
  let headerRow = 0
  let rowsRead = 0
  let moneyIssues = 0
  let qtyIssues = 0
  let emptySku = 0
  let fatal: Error | null = null
  let streamRef: Readable | null = null

  const sheetStream = workbook.entry(sheet.path)
  if (!sheetStream) throw new Error(`未找到 Sheet XML：${sheet.path}`)

  const expectedHeaderCount = activeFields(schema).length

  const handleRow = (row: SheetRow) => {
    if (!headerRow) {
      const matched = matchesHeader(schema, row)
      if (matched >= Math.max(6, expectedHeaderCount - 1)) {
        headerRow = row.row
        // 表头个别字段不匹配时给出提示（不阻断）
        for (const field of activeFields(schema)) {
          const letter = schema.columns[field]
          const expected = schema.headers[field]
          const actual = toText(row.cells[letter])
          if (actual !== toText(expected)) {
            const critical = CRITICAL_FIELDS.includes(field)
            const message = `表头校验：${letter} 列期望「${expected}」，实际「${actual}」`
            if (critical) {
              fatal = new Error(message)
              streamRef?.destroy(fatal)
              return
            }
            warnings.push(message)
          }
        }
        return
      }
      if (row.row > 8) {
        fatal = new Error(`未能在前 8 行找到「${schema.sheetName}」合法表头，请确认文件结构`)
        streamRef?.destroy(fatal)
      }
      return
    }

    rowsRead += 1
    const cell = (letter: string) => (letter ? (row.cells[letter] ?? '') : '')
    const orderNo = toText(cell(schema.columns.orderNo))
    if (!orderNo) return

    const salesRaw = cell(schema.columns.sales)
    const qtyRaw = cell(schema.columns.qty)
    if (!isParsableMoney(salesRaw)) moneyIssues += 1
    if (!isParsableMoney(qtyRaw)) qtyIssues += 1

    const productName = toText(cell(schema.columns.productName))
    const testFlag = schema.columns.testFlag ? toText(cell(schema.columns.testFlag)) : ''
    const isTest =
      productName.includes('刷单') ||
      (!!testFlag && !['#N/A', '否', '0', '-', 'N/A'].includes(testFlag) && testFlag.includes('刷单')) ||
      testFlag === '是'

    const sku = toText(cell(schema.columns.sku))
    if (!sku) emptySku += 1

    rows.push({
      platform,
      orderNo,
      subOrderNo: toText(cell(schema.columns.subOrderNo)),
      orderStatus: cleanStatus(cell(schema.columns.orderStatus)),
      afterSaleStatus: cleanStatus(cell(schema.columns.afterSale)),
      sku,
      productName,
      productCode: toText(cell(schema.columns.productCode)),
      qty: parseQty(qtyRaw),
      salesAmount: parseMoney(salesRaw),
      shop: toText(cell(schema.columns.shop)),
      createdAt: toText(cell(schema.columns.createdAt)),
      isTest,
      sourceFile: path.basename(filePath),
    })
  }

  const source = sheetStream.stream()
  streamRef = source
  try {
    await streamSheetRows(source, {
      sharedStrings,
      columns,
      onRow: (row) => {
        try {
          handleRow(row)
        } catch (error) {
          fatal = error as Error
          source.destroy(error as Error)
        }
      },
    })
  } catch (error) {
    if (fatal) throw fatal
    throw error
  }

  if (fatal) throw fatal
  if (!headerRow) throw new Error(`未找到「${schema.sheetName}」表头行`)

  if (moneyIssues) warnings.push(`销售金额存在 ${moneyIssues} 行非数值，已按 0 处理`)
  if (qtyIssues) warnings.push(`商品数量存在 ${qtyIssues} 行非数值，已按 0 处理`)
  if (emptySku) warnings.push(`有 ${emptySku} 行缺少 SKU 编码，成本无法匹配`)

  return { platform, sheetName: schema.sheetName, variant: schema.variant, headerRow, rowsRead, rows, warnings }
}
