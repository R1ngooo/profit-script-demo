import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { FileStat, OrderRow, RefreshStatus } from '../../shared/types'
import { readCache, writeCache } from '../cache'
import { readOrderFile } from '../readers/orderSource'
import { readCostTable, type CostTableData } from '../readers/costTable'
import { readAdSpend, type AdSpendData } from '../readers/adSpend'
import {
  discoverCommissionFiles,
  platformFromPath,
  readCommissionFile,
  type CommissionFileData,
  type CommissionRecord,
  type LeaderFeeRecord,
} from '../readers/commissionSource'
import { normalizePlatform, platformFromFileName } from '../util/numbers'
import { countIgnoredExcelFiles, isIgnoredSourceName, isIgnoredSourcePath } from '../util/sourceFilter'
import type { ConfigStore } from '../config/store'

export interface CommissionDataset {
  records: CommissionRecord[]
  leaderRecords: LeaderFeeRecord[]
  duplicateCount: number
  duplicateConflicts: number
  warnings: string[]
}

export interface Dataset {
  orders: OrderRow[]
  cost: CostTableData
  ad: AdSpendData
  commission: CommissionDataset
  files: FileStat[]
  warnings: string[]
  parseMs: number
  cached: boolean
  /** 商务订单（达人佣金）数据源是否接入 */
  commissionConnected: boolean
}

export const EMPTY_COST: CostTableData = {
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

const EMPTY_AD: AdSpendData = { byPlatform: {}, byProduct: {}, rows: 0, warnings: [], sourceFile: '' }

async function listXlsx(dir: string): Promise<string[]> {
  // 「历史数据」文件夹整体忽略（兼容 -历史数据 等命名）
  if (isIgnoredSourcePath(dir)) return []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.xlsx$/i.test(name) && !name.startsWith('~$') && !isIgnoredSourceName(name))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

interface CachedOrderPayload {
  platform: string
  sheetName: string
  headerRow: number
  rowsRead: number
  rows: OrderRow[]
  warnings: string[]
}

export class DatasetService {
  private dataset: Dataset | null = null
  private task: Promise<Dataset> | null = null
  private status: RefreshStatus = {
    state: 'idle',
    step: '等待加载',
    percent: 0,
    message: '',
    error: null,
    updatedAt: new Date().toISOString(),
  }

  constructor(
    private readonly excelDir: string,
    private readonly dataDir: string,
    private readonly configStore: ConfigStore,
  ) {}

  getStatus(): RefreshStatus {
    return this.status
  }

  get(): Dataset | null {
    return this.dataset
  }

  platformNames(): string[] {
    if (!this.dataset) return []
    const names = new Set<string>()
    for (const row of this.dataset.orders) {
      const name = normalizePlatform(row.platform)
      if (name) names.add(name)
    }
    for (const name of Object.keys(this.dataset.ad.byPlatform)) names.add(normalizePlatform(name))
    return [...names]
  }

  private setStatus(patch: Partial<RefreshStatus>): void {
    this.status = { ...this.status, ...patch, updatedAt: new Date().toISOString() }
  }

  async ensure(force = false): Promise<Dataset> {
    if (!force && this.dataset) return this.dataset
    if (this.task) return this.task
    this.task = this.run(force).finally(() => {
      this.task = null
    })
    return this.task
  }

  async refresh(): Promise<Dataset> {
    return this.ensure(true)
  }

  private async run(force: boolean): Promise<Dataset> {
    const startedAt = Date.now()
    this.setStatus({ state: 'parsing', step: '扫描数据目录', percent: 2, message: '', error: null })
    try {
      const config = await this.configStore.load([])
      const orderFiles = await listXlsx(path.join(this.excelDir, '订单源'))
      const costFiles = await listXlsx(path.join(this.excelDir, '成本表'))
      const adFiles = await listXlsx(path.join(this.excelDir, '月消耗表'))
      const commissionFiles = await discoverCommissionFiles(this.excelDir)
      const ignoredExcelCount = await countIgnoredExcelFiles(this.excelDir)

      const files: FileStat[] = []
      const warnings: string[] = []
      const orders: OrderRow[] = []

      if (!orderFiles.length) warnings.push('未在 excel/订单源 找到任何 .xlsx 订单文件')
      if (!costFiles.length) warnings.push('未在 excel/成本表 找到成本表，产品成本将全部按 0 计')
      if (!adFiles.length) warnings.push('未在 excel/月消耗表 找到月消耗表，广告费将全部按 0 计')
      if (!commissionFiles.length) warnings.push('未找到 excel/商务订单 目录或其中没有文件，达人佣金按 0 计')
      if (ignoredExcelCount) {
        warnings.push(`已忽略「历史数据」文件夹中的 ${ignoredExcelCount} 个 Excel 文件（不参与毛利计算）`)
      }

      const totalFiles = Math.max(1, orderFiles.length + costFiles.length + adFiles.length + commissionFiles.length)

      // 订单源
      for (let index = 0; index < orderFiles.length; index += 1) {
        const filePath = orderFiles[index]
        const fileName = path.basename(filePath)
        this.setStatus({
          step: `解析订单源 ${fileName}`,
          percent: 5 + (index / totalFiles) * 70,
          message: `${orders.length} 行已读取`,
        })
        const started = Date.now()
        const cachedPayload = await readCache<CachedOrderPayload>(this.dataDir, filePath, 'order').catch(() => null)
        if (cachedPayload && !force) {
          for (const row of cachedPayload.rows) orders.push(row)
          files.push({
            kind: 'order',
            path: filePath,
            name: fileName,
            platform: cachedPayload.platform,
            sheet: cachedPayload.sheetName,
            rows: cachedPayload.rowsRead,
            parseMs: Date.now() - started,
            cached: true,
            error: null,
            warnings: cachedPayload.warnings,
          })
          continue
        }
        try {
          const hint = platformFromFileName(fileName) || config.filePlatformMap[fileName] || ''
          const result = await readOrderFile(filePath, hint)
          const payload: CachedOrderPayload = {
            platform: result.platform,
            sheetName: result.sheetName,
            headerRow: result.headerRow,
            rowsRead: result.rowsRead,
            rows: result.rows,
            warnings: result.warnings,
          }
          await writeCache(this.dataDir, filePath, 'order', payload).catch(() => undefined)
          for (const row of result.rows) orders.push(row)
          files.push({
            kind: 'order',
            path: filePath,
            name: fileName,
            platform: result.platform,
            sheet: result.sheetName,
            rows: result.rowsRead,
            parseMs: Date.now() - started,
            cached: false,
            error: null,
            warnings: result.warnings,
          })
        } catch (error) {
          const message = (error as Error).message
          files.push({
            kind: 'order',
            path: filePath,
            name: fileName,
            platform: platformFromFileName(fileName) || null,
            sheet: '提成用',
            rows: 0,
            parseMs: Date.now() - started,
            cached: false,
            error: message,
            warnings: [],
          })
          warnings.push(`订单源「${fileName}」解析失败：${message}`)
        }
      }

      // 成本表
      const costTables: CostTableData[] = []
      for (let index = 0; index < costFiles.length; index += 1) {
        const filePath = costFiles[index]
        const fileName = path.basename(filePath)
        this.setStatus({
          step: `解析成本表 ${fileName}`,
          percent: 5 + ((orderFiles.length + index) / totalFiles) * 70,
        })
        const started = Date.now()
        const cachedPayload = await readCache<CostTableData>(this.dataDir, filePath, 'cost').catch(() => null)
        if (cachedPayload && !force) {
          costTables.push(cachedPayload)
          files.push({
            kind: 'cost',
            path: filePath,
            name: fileName,
            platform: null,
            sheet: 'Sheet1',
            rows: cachedPayload.rows,
            parseMs: Date.now() - started,
            cached: true,
            error: null,
            warnings: cachedPayload.warnings,
          })
          continue
        }
        try {
          const table = await readCostTable(filePath)
          await writeCache(this.dataDir, filePath, 'cost', table).catch(() => undefined)
          costTables.push(table)
          files.push({
            kind: 'cost',
            path: filePath,
            name: fileName,
            platform: null,
            sheet: 'Sheet1',
            rows: table.rows,
            parseMs: Date.now() - started,
            cached: false,
            error: null,
            warnings: table.warnings,
          })
        } catch (error) {
          const message = (error as Error).message
          files.push({
            kind: 'cost',
            path: filePath,
            name: fileName,
            platform: null,
            sheet: 'Sheet1',
            rows: 0,
            parseMs: Date.now() - started,
            cached: false,
            error: message,
            warnings: [],
          })
          warnings.push(`成本表「${fileName}」解析失败：${message}`)
        }
      }

      // 月消耗表
      const adTables: AdSpendData[] = []
      for (let index = 0; index < adFiles.length; index += 1) {
        const filePath = adFiles[index]
        const fileName = path.basename(filePath)
        this.setStatus({
          step: `解析月消耗表 ${fileName}`,
          percent: 5 + ((orderFiles.length + costFiles.length + index) / totalFiles) * 70,
        })
        const started = Date.now()
        const cachedPayload = await readCache<AdSpendData>(this.dataDir, filePath, 'ad').catch(() => null)
        if (cachedPayload && !force) {
          adTables.push(cachedPayload)
          files.push({
            kind: 'ad',
            path: filePath,
            name: fileName,
            platform: null,
            sheet: '汇总',
            rows: cachedPayload.rows,
            parseMs: Date.now() - started,
            cached: true,
            error: null,
            warnings: cachedPayload.warnings,
          })
          continue
        }
        try {
          const table = await readAdSpend(filePath)
          await writeCache(this.dataDir, filePath, 'ad', table).catch(() => undefined)
          adTables.push(table)
          files.push({
            kind: 'ad',
            path: filePath,
            name: fileName,
            platform: null,
            sheet: '汇总',
            rows: table.rows,
            parseMs: Date.now() - started,
            cached: false,
            error: null,
            warnings: table.warnings,
          })
        } catch (error) {
          const message = (error as Error).message
          files.push({
            kind: 'ad',
            path: filePath,
            name: fileName,
            platform: null,
            sheet: '汇总',
            rows: 0,
            parseMs: Date.now() - started,
            cached: false,
            error: message,
            warnings: [],
          })
          warnings.push(`月消耗表「${fileName}」解析失败：${message}`)
        }
      }

      // 商务订单（达人佣金）
      const commissionData: CommissionFileData[] = []
      for (let index = 0; index < commissionFiles.length; index += 1) {
        const filePath = commissionFiles[index]
        const fileName = path.basename(filePath)
        this.setStatus({
          step: `解析商务订单 ${fileName}`,
          percent: 5 + ((orderFiles.length + costFiles.length + adFiles.length + index) / totalFiles) * 70,
        })
        const started = Date.now()
        const relativePath = path.relative(this.excelDir, filePath)
        const cachedPayload = await readCache<CommissionFileData>(this.dataDir, filePath, 'commission').catch(() => null)
        if (cachedPayload && !force) {
          commissionData.push(cachedPayload)
          files.push({
            kind: 'commission',
            path: filePath,
            name: fileName,
            platform: normalizePlatform(platformFromPath(relativePath)) || null,
            sheet: cachedPayload.sheets.join('、') || '—',
            rows: cachedPayload.rows,
            parseMs: Date.now() - started,
            cached: true,
            error: null,
            warnings: cachedPayload.warnings,
          })
          continue
        }
        try {
          const data = await readCommissionFile(filePath, this.excelDir)
          await writeCache(this.dataDir, filePath, 'commission', data).catch(() => undefined)
          commissionData.push(data)
          files.push({
            kind: 'commission',
            path: filePath,
            name: fileName,
            platform: normalizePlatform(platformFromPath(relativePath)) || null,
            sheet: data.sheets.join('、') || '—',
            rows: data.rows,
            parseMs: Date.now() - started,
            cached: false,
            error: null,
            warnings: data.warnings,
          })
        } catch (error) {
          const message = (error as Error).message
          files.push({
            kind: 'commission',
            path: filePath,
            name: fileName,
            platform: normalizePlatform(platformFromPath(relativePath)) || null,
            sheet: '—',
            rows: 0,
            parseMs: Date.now() - started,
            cached: false,
            error: message,
            warnings: [],
          })
          warnings.push(`商务订单「${fileName}」解析失败：${message}`)
        }
      }

      const cost = mergeCostTables(costTables)
      const ad = mergeAdSpend(adTables)
      const commission = mergeCommissionFiles(commissionData)
      for (const data of commissionData) warnings.push(...data.warnings)
      if (commission.duplicateConflicts) {
        warnings.push(`商务订单存在 ${commission.duplicateConflicts} 条重复记录的佣金金额不一致（已按优先级取首条）`)
      }

      this.setStatus({ step: '构建汇总数据', percent: 92 })
      const parseMs = Date.now() - startedAt
      const dataset: Dataset = {
        orders,
        cost,
        ad,
        commission,
        files,
        warnings,
        parseMs,
        cached: files.length > 0 && files.every((file) => file.cached),
        commissionConnected: commissionFiles.length > 0,
      }
      this.dataset = dataset
      this.setStatus({
        state: 'ready',
        step: '完成',
        percent: 100,
        message: `${orders.length} 行订单，${files.length} 个文件`,
      })
      return dataset
    } catch (error) {
      const message = (error as Error).message
      this.setStatus({ state: 'error', step: '解析失败', percent: 100, error: message, message })
      throw error
    }
  }
}

export const EMPTY_COMMISSION: CommissionDataset = {
  records: [],
  leaderRecords: [],
  duplicateCount: 0,
  duplicateConflicts: 0,
  warnings: [],
}

/**
 * 合并多个商务订单文件：
 * - 行级佣金按 平台+订单号+SKU 去重
 * - 订单级佣金按 平台+订单号 去重
 * - 文件已按「顶层汇总文件优先」排序，重复记录保留首条
 */
export function mergeCommissionFiles(files: CommissionFileData[]): CommissionDataset {
  const records: CommissionRecord[] = []
  const recordIndex = new Map<string, number>()
  const leaderRecords: LeaderFeeRecord[] = []
  const leaderIndex = new Map<string, number>()
  let duplicateCount = 0
  let duplicateConflicts = 0

  for (const data of files) {
    for (const record of data.records) {
      const key =
        record.mode === 'line' && record.sku
          ? `${record.platform}|L|${record.orderNo}|${record.sku}`
          : `${record.platform}|O|${record.orderNo}`
      const existing = recordIndex.get(key)
      if (existing === undefined) {
        recordIndex.set(key, records.length)
        records.push(record)
      } else {
        duplicateCount += 1
        if (Math.abs(records[existing].amount - record.amount) > 0.01) duplicateConflicts += 1
      }
    }
    for (const record of data.leaderRecords) {
      const key = `${record.platform}|${record.orderNo}`
      if (leaderIndex.has(key)) continue
      leaderIndex.set(key, leaderRecords.length)
      leaderRecords.push(record)
    }
  }

  return {
    records,
    leaderRecords,
    duplicateCount,
    duplicateConflicts,
    warnings: [],
  }
}

export function mergeCostTables(tables: CostTableData[]): CostTableData {
  if (!tables.length) return EMPTY_COST
  if (tables.length === 1) return tables[0]
  const merged: CostTableData = {
    prices: {},
    names: {},
    styles: {},
    namePrices: {},
    unitPrices: {},
    additions: {},
    costColumn: tables[0].costColumn,
    costColumnHeader: tables[0].costColumnHeader,
    rows: 0,
    warnings: [],
    sourceFile: tables.map((table) => table.sourceFile).join('、'),
  }
  for (const table of tables) {
    merged.rows += table.rows
    for (const [sku, price] of Object.entries(table.prices)) {
      if (merged.prices[sku] === undefined) {
        merged.prices[sku] = price
        merged.names[sku] = table.names[sku] ?? ''
        merged.styles[sku] = table.styles[sku] ?? ''
      }
    }
    for (const [name, prices] of Object.entries(table.namePrices)) {
      ;(merged.namePrices[name] ??= []).push(...prices)
    }
    for (const [name, price] of Object.entries(table.unitPrices)) {
      if (merged.unitPrices[name] === undefined) merged.unitPrices[name] = price
    }
    for (const [name, value] of Object.entries(table.additions)) {
      if (merged.additions[name] === undefined) merged.additions[name] = value
    }
    merged.warnings.push(...table.warnings)
  }
  return merged
}

export function mergeAdSpend(tables: AdSpendData[]): AdSpendData {
  if (!tables.length) return EMPTY_AD
  if (tables.length === 1) return tables[0]
  const merged: AdSpendData = {
    byPlatform: {},
    byProduct: {},
    rows: 0,
    warnings: [],
    sourceFile: tables.map((table) => table.sourceFile).join('、'),
  }
  for (const table of tables) {
    merged.rows += table.rows
    for (const [platform, spend] of Object.entries(table.byPlatform)) {
      merged.byPlatform[platform] = (merged.byPlatform[platform] ?? 0) + spend
    }
    for (const [platform, products] of Object.entries(table.byProduct)) {
      const bucket = (merged.byProduct[platform] ??= {})
      for (const [product, spend] of Object.entries(products)) {
        bucket[product] = (bucket[product] ?? 0) + spend
      }
    }
    merged.warnings.push(...table.warnings)
  }
  return merged
}
