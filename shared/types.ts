/** 平台规范名（与月消耗表「电商平台」列保持一致） */
export type PlatformName = '快手' | '视频号' | '抖音' | '天猫' | '拼多多' | '京东' | '小红书'

export type Classification = 'settle' | 'refund'

/** 规范化后的订单行（一行 = 订单里的一个 SKU 明细） */
export interface OrderRow {
  platform: string
  orderNo: string
  /** 抖音等平台的主/子订单号：佣金数据可能以子订单号出现，匹配时同时使用 */
  subOrderNo?: string
  orderStatus: string
  afterSaleStatus: string
  sku: string
  productCode: string
  productName: string
  qty: number
  salesAmount: number
  shop: string
  createdAt: string
  /** 刷单/测试单标记 */
  isTest: boolean
  sourceFile: string
}

export interface StatusPair {
  id: string
  platform: string
  orderStatus: string
  afterSaleStatus: string
  rows: number
  qty: number
  sales: number
  auto: Classification
  effective: Classification
  overridden: boolean
  ruleId: string
  reason: string
  unknown: boolean
}

export interface StatusPairUpdate {
  platform: string
  orderStatus: string
  afterSaleStatus: string
  classification: Classification
}

export interface MissingCost {
  sku: string
  productName: string
  platforms: string[]
  qty: number
  settledQty: number
  rows: number
  sales: number
  suggestion: number | null
  suggestionSource: string | null
  override: number | null
}

export interface PlatformPnl {
  platform: string
  orderRows: number
  settleRows: number
  refundRows: number
  settledSales: number
  refundSales: number
  settledQty: number
  refundQty: number
  productCost: number
  packaging: number
  shipping: number
  shippingInsurance: number
  techFee: number
  commercialInsurance: number
  commission: number
  adSpend: number
  grossProfit: number
  grossMargin: number | null
  missingCostQty: number
  missingCostSkus: number
  costCoverage: number | null
  /** 该平台匹配到的商务达人人佣金记录数（结算口径） */
  commissionRecords: number
}

export interface CommissionPlatformStat {
  platform: string
  records: number
  amount: number
  matchedRecords: number
  matchedAmount: number
  unmatchedRecords: number
  unmatchedAmount: number
  refundRecords: number
  refundAmount: number
}

export interface CommissionStats {
  totalRecords: number
  totalAmount: number
  matchedRecords: number
  matchedAmount: number
  unmatchedRecords: number
  unmatchedAmount: number
  refundRecords: number
  refundAmount: number
  byPlatform: CommissionPlatformStat[]
  /** 团长服务费（商务数据中顺带记录，当前不计入达人佣金） */
  leaderFeeRecords: number
  leaderFeeTotal: number
  files: FileStat[]
  warnings: string[]
}

export interface AdSpendRow {
  platform: string
  spend: number
  hasOrders: boolean
  files: string[]
}

export type FileKind = 'order' | 'cost' | 'ad' | 'commission'

export interface FileStat {
  kind: FileKind
  path: string
  name: string
  platform: string | null
  sheet: string
  rows: number
  parseMs: number
  cached: boolean
  error: string | null
  warnings: string[]
}

export interface ParseWarning {
  file: string
  message: string
  count: number
}

export interface DatasetStats {
  totalOrders: number
  includedOrders: number
  refundOrders: number
  testOrders: number
  parseMs: number
  cached: boolean
}

export interface Summary {
  generatedAt: string
  period: string | null
  platforms: PlatformPnl[]
  totals: PlatformPnl
  adSpendByPlatform: AdSpendRow[]
  statusPairs: StatusPair[]
  missingCosts: MissingCost[]
  commission: CommissionStats
  dataset: FileStat[]
  warnings: string[]
  parseWarnings: ParseWarning[]
  stats: DatasetStats
}

/** 费用计算方式：unit=按件单价自动算总额；total=直接填写总额 */
export type FeeMode = 'unit' | 'total'

export interface PlatformFeeSetting {
  mode: FeeMode
  /** 按件计算的单价（元/件） */
  perUnit: number
  /** 直接填写的总额（元） */
  total: number
}

/** 单个平台的人工费用配置：包装费 / 运费 / 运费险 均支持两种计费方式 */
export interface PlatformConfig {
  packaging: PlatformFeeSetting
  shipping: PlatformFeeSetting
  insurance: PlatformFeeSetting
  /** 平台技术服务费率（0–1） */
  techFeeRate: number
  /** 商业保险费率（0–1） */
  commercialInsuranceRate: number
}

export function createFeeSetting(perUnit = 0): PlatformFeeSetting {
  return { mode: 'unit', perUnit, total: 0 }
}

/** 计算某项费用的总额：按件模式 = 单价 × 结算商品数量；总额模式 = 直接填写的总额 */
export function feeAmount(setting: PlatformFeeSetting | undefined, settledQty: number): number {
  if (!setting) return 0
  return setting.mode === 'total' ? setting.total : setting.perUnit * settledQty
}

export interface Config {
  version: 1
  filters: {
    /** 排除刷单/测试订单 */
    excludeTestOrders: boolean
    /** 把无订单源平台的广告费并入总毛利 */
    includeAdPlatformsWithoutOrders: boolean
  }
  platforms: Record<string, PlatformConfig>
  /** SKU → 手工成本单价（优先于成本表） */
  customCosts: Record<string, number>
  /** 平台 → (订单状态||售后状态) → 人工归类 */
  statusOverrides: Record<string, Record<string, Classification>>
  /** 文件名 → 平台（文件名无法识别时使用） */
  filePlatformMap: Record<string, string>
  /** 毛利平台对比表的字段顺序（可拖拽/上下移动自定义） */
  tableFieldOrder: string[]
}

export interface ConfigPayload {
  config: Config
  summary: Summary
}

export interface ConfigMeta {
  platforms: string[]
  orderPlatforms: string[]
  costColumnHeader: string
  costRows: number
  commissionConnected: boolean
  refreshStatus: RefreshStatus
}

export interface DatasetInfo {
  parsing: boolean
  status: RefreshStatus
  files: FileStat[]
  warnings: string[]
  stats?: { totalOrders: number; parseMs: number; cached: boolean }
  costColumnHeader?: string
  costRows?: number
  adPlatforms?: string[]
  commissionConnected?: boolean
}

export interface RefreshStatus {
  state: 'idle' | 'parsing' | 'ready' | 'error'
  step: string
  percent: number
  message: string
  error: string | null
  updatedAt: string
}

export interface PnlLine {
  key: string
  label: string
  kind: 'income' | 'cost' | 'total'
  value: number
}

export function pairKey(orderStatus: string, afterSaleStatus: string): string {
  return `${orderStatus.trim()}||${afterSaleStatus.trim()}`
}

export function statusPairId(platform: string, orderStatus: string, afterSaleStatus: string): string {
  return `${platform}||${pairKey(orderStatus, afterSaleStatus)}`
}

/** 瀑布图各步骤（不含平台维度） */
export function buildWaterfall(pnl: PlatformPnl): PnlLine[] {
  return [
    { key: 'settledSales', label: '预估结算金额', kind: 'income', value: pnl.settledSales },
    { key: 'productCost', label: '产品成本', kind: 'cost', value: pnl.productCost },
    { key: 'packaging', label: '包装费', kind: 'cost', value: pnl.packaging },
    { key: 'shipping', label: '运费', kind: 'cost', value: pnl.shipping },
    { key: 'shippingInsurance', label: '运费险', kind: 'cost', value: pnl.shippingInsurance },
    { key: 'techFee', label: '平台技术服务费', kind: 'cost', value: pnl.techFee },
    { key: 'commercialInsurance', label: '商业保险费', kind: 'cost', value: pnl.commercialInsurance },
    { key: 'commission', label: '达人佣金', kind: 'cost', value: pnl.commission },
    { key: 'adSpend', label: '广告费', kind: 'cost', value: pnl.adSpend },
    { key: 'grossProfit', label: '粗算毛利', kind: 'total', value: pnl.grossProfit },
  ]
}

/** 产品成本费比参考线：通常应在 30% 以上 */
export const PRODUCT_COST_RATIO_BENCHMARK = 0.3

/** 缺失成本建议价：客单价（销售金额 ÷ 结算数量）× 33% */
export const MISSING_COST_SUGGESTION_RATE = 0.33

/** 产品成本费比 = 产品成本 / 预估结算金额 */
export function productCostRatio(pnl: Pick<PlatformPnl, 'productCost' | 'settledSales'>): number | null {
  if (!pnl.settledSales || pnl.settledSales <= 0) return null
  return pnl.productCost / pnl.settledSales
}

/** 退款比例 = 退款销售额 / (预估结算金额 + 退款销售额) */
export function refundRatio(pnl: Pick<PlatformPnl, 'refundSales' | 'settledSales'>): number | null {
  const total = pnl.settledSales + pnl.refundSales
  return total > 0 ? pnl.refundSales / total : null
}

export type PnlFieldKind = 'money' | 'int' | 'pct'
export type PnlFieldTone = 'auto' | 'muted' | 'cost' | 'emphasis'

export interface PnlFieldDef {
  key: string
  label: string
  kind: PnlFieldKind
  tone?: PnlFieldTone
  /** 百分比低于该值（0–1）时高亮告警 */
  warnBelow?: number
  hint?: string
}

/** 毛利板块「平台对比表」可排序字段（平台列固定在最左，不参与排序） */
export const PNL_TABLE_FIELDS: PnlFieldDef[] = [
  { key: 'settledSales', label: '预估结算金额', kind: 'money' },
  { key: 'refundSales', label: '退款额', kind: 'money', tone: 'muted' },
  { key: 'refundRatio', label: '退款比例', kind: 'pct', hint: '退款销售额 / (预估结算金额 + 退款销售额)' },
  { key: 'productCost', label: '产品成本', kind: 'money' },
  {
    key: 'productCostRatio',
    label: '产品成本费比',
    kind: 'pct',
    warnBelow: PRODUCT_COST_RATIO_BENCHMARK,
    hint: '产品成本 / 预估结算金额，通常 30% 以上',
  },
  { key: 'grossProfit', label: '粗算毛利', kind: 'money', tone: 'auto' },
  { key: 'grossMargin', label: '毛利率', kind: 'pct', tone: 'emphasis' },
  { key: 'settledQty', label: '结算件数', kind: 'int' },
  { key: 'packaging', label: '包装费', kind: 'money' },
  { key: 'shipping', label: '运费', kind: 'money' },
  { key: 'shippingInsurance', label: '运费险', kind: 'money' },
  { key: 'techFee', label: '技术服务费', kind: 'money' },
  { key: 'commercialInsurance', label: '商业保险费', kind: 'money' },
  { key: 'commission', label: '达人佣金', kind: 'money' },
  { key: 'adSpend', label: '广告费', kind: 'money', tone: 'cost' },
]

export const DEFAULT_PNL_FIELD_ORDER: string[] = PNL_TABLE_FIELDS.map((field) => field.key)

/** 校正字段顺序：过滤未知字段、去重、补齐缺失字段（保持默认相对顺序） */
export function normalizeFieldOrder(order?: string[] | null): string[] {
  const known = new Set(DEFAULT_PNL_FIELD_ORDER)
  const result: string[] = []
  for (const key of order ?? []) {
    if (known.has(key) && !result.includes(key)) result.push(key)
  }
  for (const key of DEFAULT_PNL_FIELD_ORDER) {
    if (!result.includes(key)) result.push(key)
  }
  return result
}

export function pnlFieldValue(pnl: PlatformPnl, key: string): number | null {
  if (key === 'productCostRatio') return productCostRatio(pnl)
  if (key === 'refundRatio') return refundRatio(pnl)
  const value = (pnl as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
