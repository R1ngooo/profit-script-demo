import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_PNL_FIELD_ORDER, createFeeSetting, normalizeFieldOrder } from '../../shared/types'
import type { Config, PlatformConfig, PlatformFeeSetting } from '../../shared/types'

export const KNOWN_PLATFORMS = ['快手', '视频号', '抖音', '天猫', '拼多多', '京东', '小红书'] as const

const feeSettingSchema = z.object({
  mode: z.enum(['unit', 'total']).default('unit'),
  perUnit: z.number().finite().min(0).default(0),
  total: z.number().finite().min(0).default(0),
})

const platformConfigSchema = z.object({
  packaging: feeSettingSchema.optional(),
  shipping: feeSettingSchema.optional(),
  insurance: feeSettingSchema.optional(),
  techFeeRate: z.number().finite().min(0).max(1).default(0),
  commercialInsuranceRate: z.number().finite().min(0).max(1).default(0),
  /** 兼容旧配置：旧版按件运费险单价 */
  insurancePerUnit: z.number().finite().min(0).optional(),
})

export const configSchema = z.object({
  version: z.literal(1).default(1),
  filters: z
    .object({
      excludeTestOrders: z.boolean().default(true),
      includeAdPlatformsWithoutOrders: z.boolean().default(false),
    })
    .default({}),
  /** 兼容旧配置：旧版全局包装费/运费单价（迁移到各平台按件单价） */
  unitFees: z
    .object({
      packaging: z.number().finite().min(0).default(0),
      shipping: z.number().finite().min(0).default(0),
    })
    .optional(),
  platforms: z.record(z.string(), platformConfigSchema).default({}),
  customCosts: z.record(z.string(), z.number().finite().min(0)).default({}),
  statusOverrides: z.record(z.string(), z.record(z.string(), z.enum(['settle', 'refund']))).default({}),
  filePlatformMap: z.record(z.string(), z.string()).default({}),
  tableFieldOrder: z.array(z.string()).optional(),
})

export function emptyPlatformConfig(): PlatformConfig {
  return {
    packaging: createFeeSetting(),
    shipping: createFeeSetting(),
    insurance: createFeeSetting(),
    techFeeRate: 0,
    commercialInsuranceRate: 0,
  }
}

export function defaultConfig(extraPlatforms: string[] = []): Config {
  const platforms: Record<string, PlatformConfig> = {}
  for (const name of [...KNOWN_PLATFORMS, ...extraPlatforms]) {
    if (!platforms[name]) platforms[name] = emptyPlatformConfig()
  }
  return {
    version: 1,
    filters: { excludeTestOrders: true, includeAdPlatformsWithoutOrders: false },
    platforms,
    customCosts: {},
    statusOverrides: {},
    filePlatformMap: {},
    tableFieldOrder: [...DEFAULT_PNL_FIELD_ORDER],
  }
}

function normalizeFeeSetting(
  setting: Partial<PlatformFeeSetting> | undefined,
  legacyPerUnit: number | undefined,
): PlatformFeeSetting {
  if (setting) {
    return {
      mode: setting.mode ?? 'unit',
      perUnit: setting.perUnit ?? 0,
      total: setting.total ?? 0,
    }
  }
  return { mode: 'unit', perUnit: legacyPerUnit ?? 0, total: 0 }
}

/** 合并并校验配置，保证已知平台都有条目；同时把旧版全局/按件配置迁移到新结构 */
export function normalizeConfig(input: unknown, extraPlatforms: string[] = []): Config {
  const parsed = configSchema.parse(input ?? {})
  const base = defaultConfig(extraPlatforms)
  const legacyPackaging = parsed.unitFees?.packaging
  const legacyShipping = parsed.unitFees?.shipping

  const platforms: Record<string, PlatformConfig> = {}
  const platformNames = new Set([...Object.keys(base.platforms), ...Object.keys(parsed.platforms ?? {})])
  for (const name of platformNames) {
    const value = parsed.platforms?.[name]
    platforms[name] = {
      packaging: normalizeFeeSetting(value?.packaging, legacyPackaging),
      shipping: normalizeFeeSetting(value?.shipping, legacyShipping),
      insurance: normalizeFeeSetting(value?.insurance, value?.insurancePerUnit),
      techFeeRate: value?.techFeeRate ?? 0,
      commercialInsuranceRate: value?.commercialInsuranceRate ?? 0,
    }
  }

  return {
    version: 1,
    filters: { ...base.filters, ...parsed.filters },
    platforms,
    customCosts: { ...parsed.customCosts },
    statusOverrides: { ...parsed.statusOverrides },
    filePlatformMap: { ...parsed.filePlatformMap },
    tableFieldOrder: normalizeFieldOrder(parsed.tableFieldOrder),
  }
}

export class ConfigStore {
  private readonly filePath: string
  private cache: Config | null = null

  /** dataDir 为保存 config.json 的目录（打包运行时由启动参数决定） */
  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'config.json')
  }

  async load(extraPlatforms: string[] = []): Promise<Config> {
    if (this.cache) return normalizeConfig(this.cache, extraPlatforms)
    try {
      const text = await readFile(this.filePath, 'utf8')
      this.cache = JSON.parse(text)
    } catch {
      this.cache = null
    }
    return normalizeConfig(this.cache, extraPlatforms)
  }

  async save(input: unknown, extraPlatforms: string[] = []): Promise<Config> {
    const config = normalizeConfig(input, extraPlatforms)
    const text = JSON.stringify(config, null, 2)
    // 写盘前先做一次序列化校验，避免把损坏内容写入配置
    JSON.parse(text)
    await mkdir(path.dirname(this.filePath), { recursive: true })
    // 保留上一份配置，误操作/异常时可人工恢复
    try {
      await copyFile(this.filePath, `${this.filePath}.bak`)
    } catch {
      /* 首次保存没有旧文件 */
    }
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, this.filePath)
    this.cache = config
    return config
  }
}
