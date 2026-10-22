import type {
  Config,
  ConfigMeta,
  ConfigPayload,
  DatasetInfo,
  RefreshStatus,
  Summary,
} from '@shared/types'

export type SummaryResponse = Summary | { parsing: true; status: RefreshStatus }

export interface AppInfo {
  version: string
  name: string
  packaged: boolean
  home: string
  excelDir: string
  dataDir: string
  distDir: string
  cacheDir: string
  configFile: string
}

/** 缺失成本批量补录：上传解析结果 */
export interface CostImportMatch {
  sku: string
  productName: string
  cost: number
}

export interface CostImportResponse {
  fileName: string
  sheets: string[]
  headerRow: number
  parsedRows: number
  matched: CostImportMatch[]
  unknown: CostImportMatch[]
  unknownCount: number
  invalid: Array<{ reason: string; sku: string; value: string }>
  invalidCount: number
  warnings: string[]
}

export const COST_TEMPLATE_URL = '/api/costs/template.xlsx'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error
    throw new Error(message || `请求失败（HTTP ${res.status}）`)
  }
  return data as T
}

export const api = {
  appInfo: () => request<AppInfo>('/api/app-info'),
  openPath: (kind: 'home' | 'excel' | 'data') =>
    request<{ ok: boolean; path?: string; error?: string }>('/api/open-path', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  summary: () => request<SummaryResponse>('/api/summary'),
  config: () => request<{ config: Config; meta: ConfigMeta }>('/api/config'),
  saveConfig: (config: Config) =>
    request<ConfigPayload>('/api/config', { method: 'PUT', body: JSON.stringify(config) }),
  previewConfig: (config: Config) =>
    request<{ summary: Summary }>('/api/config/preview', { method: 'POST', body: JSON.stringify(config) }),
  setStatusPair: (body: {
    platform: string
    orderStatus: string
    afterSaleStatus: string
    classification: 'settle' | 'refund'
  }) => request<ConfigPayload>('/api/status-pairs', { method: 'PUT', body: JSON.stringify(body) }),
  resetStatusPairs: (body: { platform?: string; orderStatus?: string; afterSaleStatus?: string }) =>
    request<ConfigPayload>('/api/status-pairs', { method: 'DELETE', body: JSON.stringify(body) }),
  refresh: () => request<{ started: boolean; status: RefreshStatus }>('/api/refresh', { method: 'POST' }),
  refreshStatus: () => request<{ status: RefreshStatus; ready: boolean }>('/api/refresh/status'),
  dataset: () => request<DatasetInfo>('/api/dataset'),
  importCosts: (fileName: string, dataBase64: string) =>
    request<CostImportResponse>('/api/costs/import', {
      method: 'POST',
      body: JSON.stringify({ fileName, dataBase64 }),
    }),
}
