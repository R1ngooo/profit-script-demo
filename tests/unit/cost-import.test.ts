import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildCostTemplateWorkbook, parseCostWorkbook } from '../../server/costBatch'

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const data = await workbook.xlsx.writeBuffer()
  return Buffer.from(data as ArrayBuffer)
}

async function workbookWithRows(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  for (const row of rows) sheet.addRow(row)
  return toBuffer(workbook)
}

describe('成本批量补录解析', () => {
  it('按商品编码 + 成本价读取，忽略无关列与空行', async () => {
    const buffer = await workbookWithRows([
      ['商品编码', '商品名', '成本价', '备注'],
      ['SKU-A', '商品 A', 1.23, '可忽略'],
      ['SKU-B', '商品 B', '¥4.56', ''],
      ['', '', '', ''],
      ['SKU-C', '商品 C', '', '未填成本'],
      ['SKU-D', '', 'abc', '非法成本'],
    ])
    const result = await parseCostWorkbook(buffer)
    expect(result.rows).toEqual([
      { sku: 'SKU-A', productName: '商品 A', cost: 1.23 },
      { sku: 'SKU-B', productName: '商品 B', cost: 4.56 },
    ])
    expect(result.headerRow).toBe(1)
    expect(result.ignored.map((item) => item.reason)).toEqual(['invalidCost', 'invalidCost'])
  })

  it('兼容原成本表列布局（款式编码/商品编码/商品名…成本单价在 F 列）', async () => {
    const buffer = await workbookWithRows([
      ['成本表（示例）'],
      ['款式编码', '商品编码', '商品名', '数量', '图片', '成本单价'],
      ['STYLE-1', 'SKU-E', '商品 E', 3, '', 8.8],
      ['STYLE-2', 'SKU-F', '商品 F', 1, '', '12.00'],
    ])
    const result = await parseCostWorkbook(buffer)
    expect(result.headerRow).toBe(2)
    expect(result.rows).toEqual([
      { sku: 'SKU-E', productName: '商品 E', cost: 8.8 },
      { sku: 'SKU-F', productName: '商品 F', cost: 12 },
    ])
  })

  it('优先取「成本价」而不是「建议成本价」列', async () => {
    const buffer = await workbookWithRows([
      ['商品编码', '商品名', '建议成本价（仅供参考）', '成本价'],
      ['SKU-G', '商品 G', 99, 5.5],
    ])
    const result = await parseCostWorkbook(buffer)
    expect(result.rows).toEqual([{ sku: 'SKU-G', productName: '商品 G', cost: 5.5 }])
  })

  it('重复 SKU 取最后一行并给出提示', async () => {
    const buffer = await workbookWithRows([
      ['SKU', '成本价'],
      ['SKU-H', 1],
      ['SKU-H', 2],
    ])
    const result = await parseCostWorkbook(buffer)
    expect(result.rows).toEqual([{ sku: 'SKU-H', productName: '', cost: 2 }])
    expect(result.warnings.join('')).toContain('重复')
  })

  it('没有可用表头时报错', async () => {
    const buffer = await workbookWithRows([['随便一列', '另一列'], ['a', 'b']])
    await expect(parseCostWorkbook(buffer)).rejects.toThrow('未找到有效表头')
  })
})

describe('补录模板', () => {
  it('关键列与成本表一致，含说明页且成本列留空', async () => {
    const buffer = await buildCostTemplateWorkbook(
      [
        { sku: 'SKU-A', productName: '商品 A', suggestion: 3.5, platforms: ['快手', '抖音'], settledQty: 12 },
        { sku: 'SKU-B', productName: '商品 B', suggestion: null, platforms: ['天猫'], settledQty: 4 },
      ],
      '成本单价',
      '2026年1月',
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['成本补录', '填写说明'])
    const sheet = workbook.getWorksheet('成本补录')!
    const header = (sheet.getRow(1).values as unknown[]).slice(1)
    expect(header).toEqual([
      '款式编码',
      '商品编码',
      '商品名',
      '成本价（原表列：成本单价）',
      '建议成本价（仅供参考）',
      '平台',
      '结算件数',
      '备注',
    ])
    expect(sheet.rowCount).toBe(3)
    const first = sheet.getRow(2)
    expect(first.getCell(2).value).toBe('SKU-A')
    expect(first.getCell(3).value).toBe('商品 A')
    expect(first.getCell(4).value ?? null).toBeNull()
    expect(first.getCell(5).value).toBe(3.5)
    expect(first.getCell(6).value).toBe('快手、抖音')
    expect(first.getCell(7).value).toBe(12)
  })

  it('模板填写成本价后可被解析器直接识别（含原成本表列名）', async () => {
    const templateBuffer = await buildCostTemplateWorkbook(
      [{ sku: 'SKU-X', productName: '商品 X', suggestion: 2, platforms: ['快手'], settledQty: 9 }],
      '26年8月份',
      '2026年8月',
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(templateBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.getWorksheet('成本补录')!
    sheet.getRow(2).getCell(4).value = 7.7
    const filled = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
    const parsed = await parseCostWorkbook(filled)
    expect(parsed.rows).toEqual([{ sku: 'SKU-X', productName: '商品 X', cost: 7.7 }])
  })
})
