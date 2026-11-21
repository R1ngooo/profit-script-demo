import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import { readOrderFile } from '../../server/readers/orderSource'

const tempDirs: string[] = []

async function writeWorkbook(
  sheetName: string,
  headers: Record<string, string>,
  values: Record<string, string | number>,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'profit-order-'))
  tempDirs.push(root)
  const filePath = path.join(root, 'test.xlsx')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  for (const [letter, value] of Object.entries(headers)) sheet.getCell(`${letter}1`).value = value
  for (const [letter, value] of Object.entries(values)) sheet.getCell(`${letter}2`).value = value
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('订单源多版本表头识别', () => {
  it('识别 10 月新版快手格式（毛利用+提成用）', async () => {
    const file = await writeWorkbook(
      '毛利用+提成用',
      {
        A: '订单号',
        H: '订单状态',
        W: '售后状态',
        AE: 'SKU编码',
        AF: '产品名称',
        AC: '商品ID',
        Q: '成交数量',
        AH: '销售金额',
        BX: '店铺名称',
        D: '订单创建时间',
        AL: '刷单',
      },
      {
        A: 'KS-NEW-1',
        H: '已完成',
        W: '无售后',
        AE: 'SKU-NEW',
        AF: '新款商品',
        AC: 'P-1',
        Q: 2,
        AH: 100,
        BX: '测试店铺',
        D: '2026-10-01',
        AL: '否',
      },
    )
    const result = await readOrderFile(file, '快手')
    expect(result.variant).toBe('2026.10+')
    expect(result.sheetName).toBe('毛利用+提成用')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      orderNo: 'KS-NEW-1',
      orderStatus: '已完成',
      sku: 'SKU-NEW',
      productName: '新款商品',
      qty: 2,
      salesAmount: 100,
      shop: '测试店铺',
    })
  })

  it('旧版快手格式回退识别（提成用）', async () => {
    const file = await writeWorkbook(
      '提成用',
      {
        A: '订单号',
        H: '订单状态',
        W: '售后状态',
        AE: 'SKU编码',
        AF: '产品名称',
        AC: '商品ID',
        Q: '成交数量',
        AI: '销售金额',
        BY: '店铺名称',
        D: '订单创建时间',
        AM: '刷单',
      },
      {
        A: 'KS-OLD-1',
        H: '交易成功',
        W: '无售后',
        AE: 'SKU-OLD',
        AF: '旧款商品',
        AC: 'P-2',
        Q: 1,
        AI: 88.5,
        BY: '旧店铺',
        D: '2026-09-01',
        AM: '#N/A',
      },
    )
    const result = await readOrderFile(file, '快手')
    expect(result.variant).toBe('旧版')
    expect(result.rows[0].salesAmount).toBeCloseTo(88.5)
    expect(result.rows[0].shop).toBe('旧店铺')
  })

  it('视频号新版同名商品名称列按列字母取内部商品名', async () => {
    const file = await writeWorkbook(
      '提成用',
      {
        A: '订单号',
        G: '订单状态',
        BZ: '商品售后',
        BA: '商品名称',
        BB: '商品编码(平台)',
        BC: '商品编码(自定义)',
        BD: 'SKU编码(自定义)',
        BE: '商品名称',
        BK: '商品数量',
        BN: '销售金额',
        CB: '店铺名称',
        B: '订单下单时间',
      },
      {
        A: 'WX-1',
        G: '已完成',
        BZ: '无',
        BA: '平台长标题',
        BB: '1000',
        BC: 'C-1',
        BD: 'SKU-WX',
        BE: '内部商品名',
        BK: 3,
        BN: 179.7,
        CB: '视频号店',
        B: '2026-10-02',
      },
    )
    const result = await readOrderFile(file, '视频号')
    expect(result.variant).toBe('2026.10+')
    expect(result.rows[0].productName).toBe('内部商品名')
    expect(result.rows[0].sku).toBe('SKU-WX')
    expect(result.rows[0].qty).toBe(3)
  })

  it('表头完全不匹配时报错并列出工作表', async () => {
    const file = await writeWorkbook('随便', { A: '订单号' }, { A: 'X' })
    await expect(readOrderFile(file, '快手')).rejects.toThrow('未找到匹配的订单表')
  })
})
