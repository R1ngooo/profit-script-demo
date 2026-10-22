import ExcelJS from 'exceljs'
import { productCostRatio, refundRatio } from '../shared/types'
import type { Config, Summary } from '../shared/types'

const CLASSIFICATION_LABEL: Record<string, string> = { settle: '预估结算', refund: '退款订单' }

export async function buildExportWorkbook(summary: Summary, config: Config): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'profit-script'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('平台汇总')
  summarySheet.columns = [
    { header: '平台', key: 'platform', width: 12 },
    { header: '订单行数', key: 'orderRows', width: 12 },
    { header: '预估结算行数', key: 'settleRows', width: 14 },
    { header: '退款行数', key: 'refundRows', width: 12 },
    { header: '预估结算金额', key: 'settledSales', width: 16 },
    { header: '退款销售额', key: 'refundSales', width: 14 },
    { header: '退款比例', key: 'refundRatio', width: 12 },
    { header: '结算商品数量', key: 'settledQty', width: 14 },
    { header: '产品成本', key: 'productCost', width: 14 },
    { header: '产品成本费比', key: 'productCostRatio', width: 14 },
    { header: '包装费', key: 'packaging', width: 12 },
    { header: '运费', key: 'shipping', width: 12 },
    { header: '运费险', key: 'shippingInsurance', width: 12 },
    { header: '平台技术服务费', key: 'techFee', width: 16 },
    { header: '商业保险费', key: 'commercialInsurance', width: 14 },
    { header: '达人佣金', key: 'commission', width: 12 },
    { header: '广告费', key: 'adSpend', width: 14 },
    { header: '粗算毛利', key: 'grossProfit', width: 14 },
    { header: '毛利率', key: 'grossMargin', width: 10 },
    { header: '成本覆盖率', key: 'costCoverage', width: 12 },
    { header: '缺失成本SKU数', key: 'missingCostSkus', width: 14 },
  ]
  for (const pnl of [...summary.platforms, summary.totals]) {
    const costRatio = productCostRatio(pnl)
    const refund = refundRatio(pnl)
    summarySheet.addRow({
      ...pnl,
      grossMargin: pnl.grossMargin === null ? '' : `${(pnl.grossMargin * 100).toFixed(2)}%`,
      costCoverage: pnl.costCoverage === null ? '' : `${(pnl.costCoverage * 100).toFixed(2)}%`,
      productCostRatio: costRatio === null ? '' : `${(costRatio * 100).toFixed(2)}%`,
      refundRatio: refund === null ? '' : `${(refund * 100).toFixed(2)}%`,
    })
  }

  const pairSheet = workbook.addWorksheet('状态判定')
  pairSheet.columns = [
    { header: '平台', key: 'platform', width: 10 },
    { header: '订单状态', key: 'orderStatus', width: 14 },
    { header: '售后状态', key: 'afterSaleStatus', width: 20 },
    { header: '订单行数', key: 'rows', width: 10 },
    { header: '销售额', key: 'sales', width: 14 },
    { header: '自动判定', key: 'auto', width: 12 },
    { header: '最终判定', key: 'effective', width: 12 },
    { header: '是否人工', key: 'overridden', width: 10 },
    { header: '判定原因', key: 'reason', width: 60 },
  ]
  for (const pair of summary.statusPairs) {
    pairSheet.addRow({
      ...pair,
      auto: CLASSIFICATION_LABEL[pair.auto],
      effective: CLASSIFICATION_LABEL[pair.effective],
      overridden: pair.overridden ? '人工' : '自动',
    })
  }

  const missingSheet = workbook.addWorksheet('缺失成本')
  missingSheet.columns = [
    { header: 'SKU编码', key: 'sku', width: 28 },
    { header: '商品名称', key: 'productName', width: 30 },
    { header: '平台', key: 'platforms', width: 16 },
    { header: '结算数量', key: 'qty', width: 12 },
    { header: '销售额', key: 'sales', width: 14 },
    { header: '建议单价', key: 'suggestion', width: 12 },
    { header: '人工单价', key: 'override', width: 12 },
  ]
  for (const item of summary.missingCosts) {
    missingSheet.addRow({ ...item, platforms: item.platforms.join('、') })
  }

  const adSheet = workbook.addWorksheet('广告费明细')
  adSheet.columns = [
    { header: '平台', key: 'platform', width: 12 },
    { header: '消耗', key: 'spend', width: 16 },
    { header: '是否有订单源', key: 'hasOrders', width: 14 },
  ]
  for (const row of summary.adSpendByPlatform) {
    adSheet.addRow({ ...row, hasOrders: row.hasOrders ? '是' : '否' })
  }

  const commissionSheet = workbook.addWorksheet('商务订单佣金')
  commissionSheet.columns = [
    { header: '平台', key: 'platform', width: 10 },
    { header: '佣金记录数', key: 'records', width: 12 },
    { header: '佣金总额', key: 'amount', width: 14 },
    { header: '计入毛利（结算订单）', key: 'matchedAmount', width: 18 },
    { header: '已计入条数', key: 'matchedRecords', width: 12 },
    { header: '退款订单不计金额', key: 'refundAmount', width: 16 },
    { header: '未匹配金额', key: 'unmatchedAmount', width: 14 },
  ]
  for (const row of summary.commission.byPlatform) commissionSheet.addRow(row)
  commissionSheet.addRow({
    platform: '合计',
    records: summary.commission.totalRecords,
    amount: summary.commission.totalAmount,
    matchedAmount: summary.commission.matchedAmount,
    matchedRecords: summary.commission.matchedRecords,
    refundAmount: summary.commission.refundAmount,
    unmatchedAmount: summary.commission.unmatchedAmount,
  })

  const customCostEntries = Object.entries(config.customCosts)
  if (customCostEntries.length) {
    const costSheet = workbook.addWorksheet('成本补录')
    costSheet.columns = [
      { header: 'SKU 编码', key: 'sku', width: 30 },
      { header: '补录成本单价', key: 'cost', width: 16 },
    ]
    for (const [sku, cost] of customCostEntries) costSheet.addRow({ sku, cost })
  }

  const configSheet = workbook.addWorksheet('计算参数')
  configSheet.columns = [
    { header: '参数', key: 'name', width: 26 },
    { header: '取值', key: 'value', width: 40 },
  ]
  const configRows: Array<[string, string]> = [
    ['计费口径 ·「件」', '结算商品数量（订单商品数量字段在预估结算订单上的汇总，退款订单不计）'],
    ['排除刷单/测试订单', config.filters.excludeTestOrders ? '是' : '否'],
    ['无订单源平台广告费并入毛利', config.filters.includeAdPlatformsWithoutOrders ? '是' : '否'],
  ]
  const formatFee = (fee: { mode: string; perUnit: number; total: number }): { mode: string; value: string } => ({
    mode: fee.mode === 'total' ? '直接填写总额' : '按件单价 × 结算商品数量',
    value: fee.mode === 'total' ? `¥${fee.total}` : `¥${fee.perUnit}/件`,
  })
  for (const [name, value] of Object.entries(config.platforms)) {
    for (const [label, fee] of [
      ['包装费', value.packaging],
      ['运费', value.shipping],
      ['运费险', value.insurance],
    ] as const) {
      const formatted = formatFee(fee)
      configRows.push([`${name} · ${label}计算方式`, formatted.mode])
      configRows.push([`${name} · ${label}取值`, formatted.value])
    }
    configRows.push([`${name} · 平台技术服务费率`, `${(value.techFeeRate * 100).toFixed(4)}%`])
    configRows.push([`${name} · 商业保险费率`, `${(value.commercialInsuranceRate * 100).toFixed(4)}%`])
  }
  for (const [name, value] of configRows) configSheet.addRow({ name, value })

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}
