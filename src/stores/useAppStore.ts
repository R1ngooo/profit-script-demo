import { defineStore } from 'pinia'
import { DEFAULT_PNL_FIELD_ORDER, createFeeSetting, normalizeFieldOrder } from '@shared/types'
import type {
  Config,
  ConfigMeta,
  DatasetInfo,
  PlatformConfig,
  PlatformFeeSetting,
  RefreshStatus,
  StatusPair,
  Summary,
} from '@shared/types'
import { api, type AppInfo, type SummaryResponse } from '@/api/client'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createPlatformConfig(): PlatformConfig {
  return {
    packaging: createFeeSetting(),
    shipping: createFeeSetting(),
    insurance: createFeeSetting(),
    techFeeRate: 0,
    commercialInsuranceRate: 0,
  }
}

function isParsing(response: SummaryResponse): response is { parsing: true; status: RefreshStatus } {
  return (response as { parsing?: boolean }).parsing === true
}

function initialRefresh(): RefreshStatus {
  return { state: 'idle', step: '等待加载', percent: 0, message: '', error: null, updatedAt: '' }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 参与「人工填写」草案比较的参数范围（表头排序属于视图偏好，单独即时保存） */
function paramSignature(config: Config | null): string {
  if (!config) return ''
  return JSON.stringify({
    platforms: config.platforms,
    customCosts: config.customCosts,
    filters: config.filters,
  })
}

/** 统计未保存的参数修改项数，用于按钮上的提示 */
function countConfigChanges(config: Config | null, saved: Config | null): number {
  if (!config || !saved) return 0
  let count = 0
  if (config.filters.excludeTestOrders !== saved.filters.excludeTestOrders) count += 1
  if (config.filters.includeAdPlatformsWithoutOrders !== saved.filters.includeAdPlatformsWithoutOrders) count += 1

  const platformNames = new Set([...Object.keys(config.platforms), ...Object.keys(saved.platforms)])
  for (const name of platformNames) {
    if (JSON.stringify(config.platforms[name]) !== JSON.stringify(saved.platforms[name])) count += 1
  }

  const skus = new Set([...Object.keys(config.customCosts), ...Object.keys(saved.customCosts)])
  for (const sku of skus) {
    if (config.customCosts[sku] !== saved.customCosts[sku]) count += 1
  }
  return count
}

export interface ToastState {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}

export type ParamSaveState = 'idle' | 'previewing' | 'saving' | 'saved'

let previewTimer: ReturnType<typeof setTimeout> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let previewRequestId = 0
let fieldOrderChain: Promise<void> = Promise.resolve()

export const useAppStore = defineStore('app', {
  state: () => ({
    config: null as Config | null,
    /** 最近一次提交并保存到服务端的配置（用于撤销） */
    savedConfig: null as Config | null,
    appInfo: null as AppInfo | null,
    meta: null as ConfigMeta | null,
    summary: null as Summary | null,
    datasetInfo: null as DatasetInfo | null,
    loadState: 'loading' as 'loading' | 'ready' | 'error',
    error: '',
    refresh: initialRefresh(),
    refreshing: false,
    saving: false,
    previewing: false,
    paramDirty: false,
    saveState: 'idle' as ParamSaveState,
    lastSavedAt: '',
    theme: 'light' as 'light' | 'dark',
    toast: null as ToastState | null,
    activePlatform: '',
  }),
  getters: {
    totals: (state) => state.summary?.totals ?? null,
    platforms: (state) => state.summary?.platforms ?? [],
    statusPairs: (state) => state.summary?.statusPairs ?? [],
    missingCosts: (state) => state.summary?.missingCosts ?? [],
    adSpendRows: (state) => state.summary?.adSpendByPlatform ?? [],
    warnings: (state) => state.summary?.warnings ?? [],
    orderPlatforms: (state) =>
      (state.summary?.platforms ?? []).filter((pnl) => pnl.orderRows > 0).map((pnl) => pnl.platform),
    includedPlatforms: (state) => (state.summary?.platforms ?? []).map((pnl) => pnl.platform),
    fileCount: (state) => state.summary?.dataset.filter((file) => !file.error).length ?? 0,
    allFiles: (state) => state.summary?.dataset ?? [],
    parseWarnings: (state) => state.summary?.parseWarnings ?? [],
    configMetaPlatforms: (state) => state.meta?.platforms ?? [],
    pendingChangeCount: (state): number => countConfigChanges(state.config, state.savedConfig),
    canSubmit: (state): boolean => state.paramDirty && !state.saving,
  },
  actions: {
    initTheme() {
      const saved = localStorage.getItem('profit-theme')
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
      const theme = saved === 'dark' || saved === 'light' ? saved : prefersDark ? 'dark' : 'light'
      this.theme = theme
      document.documentElement.dataset.theme = theme
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = this.theme
      localStorage.setItem('profit-theme', this.theme)
    },
    notify(message: string, tone: ToastState['tone'] = 'info') {
      this.toast = { id: Date.now(), message, tone }
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        this.toast = null
      }, 3600)
    },
    fail(error: unknown) {
      this.loadState = 'error'
      this.error = error instanceof Error ? error.message : String(error)
    },
    refreshDirty() {
      this.paramDirty = paramSignature(this.config) !== paramSignature(this.savedConfig)
      if (!this.paramDirty) {
        this.saveState = 'idle'
        if (previewTimer) {
          clearTimeout(previewTimer)
          previewTimer = null
        }
        this.previewing = false
      }
    },
    async bootstrap() {
      this.initTheme()
      this.loadState = 'loading'
      this.error = ''
      try {
        const [{ config, meta }, appInfo] = await Promise.all([
          api.config(),
          api.appInfo().catch(() => null),
        ])
        this.config = clone(config)
        this.savedConfig = clone(config)
        this.paramDirty = false
        this.meta = meta
        this.appInfo = appInfo
        this.activePlatform = meta.orderPlatforms[0] ?? meta.platforms[0] ?? '快手'
        await this.waitForReady()
      } catch (error) {
        this.fail(error)
      }
    },
    async openPath(kind: 'home' | 'excel' | 'data') {
      try {
        const result = await api.openPath(kind)
        if (result.ok) {
          const label = kind === 'excel' ? '源文件目录' : kind === 'data' ? '数据目录' : '应用目录'
          this.notify(`已打开${label}${result.path ? `：${result.path}` : ''}`, 'success')
        } else {
          this.notify(result.error ?? '打开目录失败', 'error')
        }
      } catch (error) {
        this.notify(error instanceof Error ? error.message : '打开目录失败', 'error')
      }
    },
    async waitForReady() {
      if (!this.summary) this.loadState = 'loading'
      for (let attempt = 0; attempt < 1800; attempt += 1) {
        try {
          const response = await api.summary()
          if (isParsing(response)) {
            this.refresh = response.status
            await sleep(700)
            continue
          }
          this.summary = response
          this.loadState = 'ready'
          this.error = ''
          this.refresh = {
            state: 'ready',
            step: '完成',
            percent: 100,
            message: '',
            error: null,
            updatedAt: new Date().toISOString(),
          }
          return
        } catch (error) {
          if (attempt > 4) throw error
          await sleep(1200)
        }
      }
      throw new Error('数据解析超时，请点击「刷新数据」重试')
    },
    async refreshData() {
      if (this.refreshing) return
      if (this.paramDirty) {
        this.notify('有未保存的参数修改，请先「提交并保存」或「撤销修改」后再刷新数据', 'error')
        return
      }
      this.refreshing = true
      try {
        const started = await api.refresh()
        this.refresh = started.status
        for (let attempt = 0; attempt < 1800; attempt += 1) {
          const { status } = await api.refreshStatus()
          this.refresh = status
          if (status.state === 'error') throw new Error(status.error ?? '重新解析失败')
          if (status.state === 'ready') break
          await sleep(500)
        }
        await this.waitForReady()
        try {
          const { config, meta } = await api.config()
          this.config = clone(config)
          this.savedConfig = clone(config)
          this.paramDirty = false
          this.meta = meta
        } catch {
          /* 忽略元信息刷新失败 */
        }
        this.notify('数据已重新解析并刷新', 'success')
      } catch (error) {
        this.fail(error)
        this.notify(error instanceof Error ? error.message : '刷新失败', 'error')
      } finally {
        this.refreshing = false
      }
    },

    /** 参数变更后：标记未保存并延时预览重算（不写配置） */
    touchParameters() {
      if (!this.config) return
      this.refreshDirty()
      if (!this.paramDirty) return
      this.saveState = 'previewing'
      if (previewTimer) clearTimeout(previewTimer)
      this.previewing = true
      previewTimer = setTimeout(() => {
        previewTimer = null
        void this.runPreview()
      }, 260)
    },
    async runPreview() {
      if (!this.config || !this.paramDirty) {
        this.previewing = false
        return
      }
      const requestId = ++previewRequestId
      try {
        const response = await api.previewConfig(clone(this.config))
        if (requestId !== previewRequestId) return
        if (response?.summary) this.summary = response.summary
        this.saveState = 'previewing'
      } catch {
        if (requestId === previewRequestId) this.saveState = 'idle'
      } finally {
        if (requestId === previewRequestId) this.previewing = false
      }
    },
    /** NumberField 失去焦点等场景：立即刷新预览（仍不保存） */
    async saveNow() {
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      if (this.paramDirty) await this.runPreview()
    },

    /** 提交并保存参数（显式按钮）；silent 用于内部动作前自动落盘 */
    async submitParameters(options: { silent?: boolean } = {}): Promise<boolean> {
      if (!this.config) return false
      if (this.saving) {
        while (this.saving) await sleep(40)
      }
      if (!this.paramDirty) {
        if (!options.silent) this.notify('当前参数没有新的修改', 'info')
        return true
      }
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      previewRequestId += 1
      this.previewing = false
      this.saving = true
      this.saveState = 'saving'
      try {
        const res = await api.saveConfig(clone(this.config))
        this.config = clone(res.config)
        this.savedConfig = clone(res.config)
        if (res.summary) this.summary = res.summary
        this.paramDirty = false
        this.lastSavedAt = new Date().toISOString()
        this.saveState = 'saved'
        if (!options.silent) this.notify('参数已提交并保存，毛利已重算', 'success')
        return true
      } catch (error) {
        this.saveState = 'idle'
        this.notify(error instanceof Error ? error.message : '参数保存失败', 'error')
        return false
      } finally {
        this.saving = false
      }
    },
    /** 撤销所有未保存的参数修改 */
    async revertParameters() {
      if (!this.savedConfig) return
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      previewRequestId += 1
      this.previewing = false
      this.config = clone(this.savedConfig)
      this.paramDirty = false
      this.saveState = 'idle'
      try {
        const response = await api.previewConfig(clone(this.savedConfig))
        if (response?.summary) this.summary = response.summary
      } catch {
        /* 预览失败时保持现有数字 */
      }
      this.notify('已撤销未保存的修改', 'info')
    },
    /** 把人工填写项重置为默认值（仅草稿，需要提交后生效） */
    resetParameters() {
      if (!this.config) return
      const platforms: Record<string, PlatformConfig> = {}
      for (const name of Object.keys(this.config.platforms)) {
        platforms[name] = createPlatformConfig()
      }
      this.config.platforms = platforms
      this.config.customCosts = {}
      this.config.filters = { excludeTestOrders: true, includeAdPlatformsWithoutOrders: false }
      this.touchParameters()
      this.notify('已填入默认参数（尚未保存，请点击「提交并保存」）', 'info')
    },

    /** 即时写入当前配置（用于表头排序等视图偏好） */
    async saveConfig(): Promise<boolean> {
      if (!this.config) return false
      if (this.saving) {
        while (this.saving) await sleep(40)
      }
      this.saving = true
      try {
        const res = await api.saveConfig(clone(this.config))
        this.config = clone(res.config)
        this.savedConfig = clone(res.config)
        if (res.summary) this.summary = res.summary
        this.paramDirty = false
        this.lastSavedAt = new Date().toISOString()
        this.saveState = 'idle'
        return true
      } catch (error) {
        this.notify(error instanceof Error ? error.message : '保存失败', 'error')
        return false
      } finally {
        this.saving = false
      }
    },
    setPlatformFee(
      platform: string,
      item: 'packaging' | 'shipping' | 'insurance',
      patch: Partial<PlatformFeeSetting>,
    ) {
      if (!this.config) return
      const current = this.config.platforms[platform] ?? createPlatformConfig()
      this.config.platforms[platform] = {
        ...current,
        [item]: { ...current[item], ...patch },
      }
      this.touchParameters()
    },
    setPlatformField(platform: string, field: 'techFeeRate' | 'commercialInsuranceRate', value: number) {
      if (!this.config) return
      const current = this.config.platforms[platform] ?? createPlatformConfig()
      this.config.platforms[platform] = { ...current, [field]: value }
      this.touchParameters()
    },
    setFilter(key: keyof Config['filters'], value: boolean) {
      if (!this.config) return
      this.config.filters[key] = value
      this.touchParameters()
    },
    setCustomCost(sku: string, value: number | null) {
      if (!this.config) return
      const next = { ...this.config.customCosts }
      if (value === null || !Number.isFinite(value)) delete next[sku]
      else next[sku] = value
      this.config.customCosts = next
      this.touchParameters()
    },
    /** 批量补录：把 Excel 解析出的 SKU 成本合并进当前草稿并触发预览 */
    applyImportedCosts(rows: Array<{ sku: string; cost: number }>): number {
      if (!this.config || !rows.length) return 0
      const next = { ...this.config.customCosts }
      let count = 0
      for (const row of rows) {
        if (!row.sku) continue
        next[row.sku] = row.cost
        count += 1
      }
      this.config.customCosts = next
      this.touchParameters()
      return count
    },
    /** 表头排序：视图偏好即时保存；不提交仍在草稿中的人工参数 */
    setTableFieldOrder(order: string[]): Promise<void> {
      if (!this.config) return Promise.resolve()
      const normalized = normalizeFieldOrder(order)
      this.config.tableFieldOrder = normalized
      fieldOrderChain = fieldOrderChain.then(async () => {
        if (!this.config) return
        if (this.paramDirty && this.savedConfig) {
          // 用「已保存参数 + 新字段顺序」落盘，避免把草稿参数一并提交
          const base = clone(this.savedConfig)
          base.tableFieldOrder = normalized
          try {
            const res = await api.saveConfig(base)
            this.savedConfig = clone(res.config)
            this.config.tableFieldOrder = res.config.tableFieldOrder
            if (res.summary) this.summary = res.summary
            this.refreshDirty()
            if (this.paramDirty) await this.runPreview()
          } catch (error) {
            this.notify(error instanceof Error ? error.message : '表头顺序保存失败', 'error')
            this.config.tableFieldOrder = this.savedConfig.tableFieldOrder
          }
          return
        }
        this.config.tableFieldOrder = normalized
        await this.saveConfig()
      })
      return fieldOrderChain
    },
    resetTableFieldOrder(): Promise<void> {
      return this.setTableFieldOrder([...DEFAULT_PNL_FIELD_ORDER])
    },
    /** 服务端返回新配置时保留尚未提交的参数草稿 */
    applyServerConfig(config: Config, summary: Summary | null): void {
      const draft = this.config
        ? {
            platforms: clone(this.config.platforms),
            customCosts: clone(this.config.customCosts),
            filters: clone(this.config.filters),
          }
        : null
      this.savedConfig = clone(config)
      this.config = clone(config)
      if (draft) {
        this.config.platforms = draft.platforms
        this.config.customCosts = draft.customCosts
        this.config.filters = draft.filters
      }
      if (summary) this.summary = summary
      this.refreshDirty()
    },
    async setPairClassification(pair: StatusPair, classification: 'settle' | 'refund') {
      try {
        const res = await api.setStatusPair({
          platform: pair.platform,
          orderStatus: pair.orderStatus,
          afterSaleStatus: pair.afterSaleStatus,
          classification,
        })
        this.applyServerConfig(res.config, res.summary ?? null)
        if (this.paramDirty) await this.runPreview()
        const label = classification === 'settle' ? '预估结算' : '退款订单'
        const draftHint = this.paramDirty ? '（未保存的参数仍为预览状态）' : ''
        this.notify(`「${pair.orderStatus} · ${pair.afterSaleStatus || '无售后'}」已归为${label}，毛利已重算${draftHint}`, 'success')
      } catch (error) {
        this.notify(error instanceof Error ? error.message : '归类失败', 'error')
      }
    },
    async resetPairs(platform?: string) {
      try {
        const res = await api.resetStatusPairs(platform ? { platform } : {})
        this.applyServerConfig(res.config, res.summary ?? null)
        if (this.paramDirty) await this.runPreview()
        const draftHint = this.paramDirty ? '（未保存的参数仍为预览状态）' : ''
        this.notify(platform ? `${platform} 已恢复自动判定${draftHint}` : `全部恢复自动判定${draftHint}`, 'success')
      } catch (error) {
        this.notify(error instanceof Error ? error.message : '恢复失败', 'error')
      }
    },
    async loadDatasetInfo() {
      try {
        this.datasetInfo = await api.dataset()
      } catch {
        this.datasetInfo = null
      }
    },
  },
})
