import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { z } from 'zod'
import { ConfigStore, KNOWN_PLATFORMS, configSchema, normalizeConfig } from './config/store'
import { DatasetService } from './pipeline/dataset'
import { computeSummary } from './pipeline/compute'
import { buildExportWorkbook } from './export'
import { buildCostTemplateWorkbook, parseCostWorkbook } from './costBatch'
import { pairKey } from '../shared/types'
import { normalizePlatform } from './util/numbers'
import { openExternal } from './runtime'

const statusPairSetSchema = z.object({
  platform: z.string().min(1),
  orderStatus: z.string(),
  afterSaleStatus: z.string(),
  classification: z.enum(['settle', 'refund']),
})

const costImportSchema = z.object({
  fileName: z.string().max(300).optional(),
  dataBase64: z.string().min(1),
})

const statusPairResetSchema = z.object({
  platform: z.string().optional(),
  orderStatus: z.string().optional(),
  afterSaleStatus: z.string().optional(),
})

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '参数'}：${issue.message}`).join('；')
}

export interface AppOptions {
  home: string
  excelDir: string
  dataDir: string
  distDir: string
  version: string
  packaged: boolean
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 })
  const configStore = new ConfigStore(options.dataDir)
  const datasetService = new DatasetService(options.excelDir, options.dataDir, configStore)
  /** 预览结果缓存：相同参数配置（如反复预览/撤销）直接复用，避免重复计算 63 万行订单 */
  const previewCache = new Map<string, ReturnType<typeof computeSummary>>()
  const PREVIEW_CACHE_LIMIT = 12

  const getConfig = () => configStore.load(datasetService.platformNames())

  // 启动即尝试恢复缓存 / 后台解析
  void datasetService.ensure().catch(() => undefined)

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  const guard = <T extends FastifyRequest, U extends FastifyReply>(
    handler: (request: T, reply: U) => Promise<unknown> | unknown,
  ) => {
    return async (request: T, reply: U) => {
      try {
        return await handler(request, reply)
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: zodMessage(error) })
        }
        request.log.error(error)
        return reply.code(500).send({ error: (error as Error).message })
      }
    }
  }

  app.get('/api/health', async () => ({
    ok: true,
    version: options.version,
    packaged: options.packaged,
    home: options.home,
    parsing: datasetService.getStatus().state === 'parsing',
    status: datasetService.getStatus(),
  }))

  app.get('/api/app-info', async () => ({
    version: options.version,
    name: 'profit-script',
    packaged: options.packaged,
    home: options.home,
    excelDir: options.excelDir,
    dataDir: options.dataDir,
    distDir: options.distDir,
    cacheDir: path.join(options.dataDir, 'cache'),
    configFile: path.join(options.dataDir, 'config.json'),
  }))

  // 打开数据目录 / 源文件目录（本地应用，便于用户放置 Excel 源文件与备份参数）
  app.post(
    '/api/open-path',
    guard(async (request) => {
      const parsed = z.object({ kind: z.enum(['home', 'excel', 'data']) }).safeParse(request.body ?? {})
      if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) }
      const target =
        parsed.data.kind === 'excel' ? options.excelDir : parsed.data.kind === 'data' ? options.dataDir : options.home
      openExternal(target)
      return { ok: true, path: target }
    }),
  )

  app.get('/api/refresh/status', async () => ({
    status: datasetService.getStatus(),
    ready: datasetService.get() !== null,
  }))

  app.post('/api/refresh', async (_request, reply) => {
    const running = datasetService.getStatus().state === 'parsing'
    if (!running) {
      previewCache.clear()
      void datasetService.refresh().catch(() => undefined)
    }
    return reply.code(202).send({ started: !running, status: datasetService.getStatus() })
  })

  app.get(
    '/api/dataset',
    guard(async (request: FastifyRequest<{ Querystring: { refresh?: string } }>, reply) => {
      if (request.query.refresh === '1') {
        void datasetService.refresh().catch(() => undefined)
      }
      const dataset = datasetService.get()
      const status = datasetService.getStatus()
      if (!dataset) {
        return reply.code(status.state === 'error' ? 500 : 202).send({
          parsing: status.state !== 'error',
          status,
          files: [],
          warnings: [],
        })
      }
      return {
        parsing: status.state === 'parsing',
        status,
        files: dataset.files,
        warnings: dataset.warnings,
        stats: {
          totalOrders: dataset.orders.length,
          parseMs: dataset.parseMs,
          cached: dataset.cached,
        },
        costColumnHeader: dataset.cost.costColumnHeader,
        costRows: dataset.cost.rows,
        adPlatforms: Object.keys(dataset.ad.byPlatform),
        commissionConnected: dataset.commissionConnected,
      }
    }),
  )

  app.get(
    '/api/summary',
    guard(async (_request, reply) => {
      const dataset = datasetService.get()
      if (!dataset) {
        const status = datasetService.getStatus()
        if (status.state === 'error') {
          return reply.code(500).send({ error: status.error || '数据解析失败', status })
        }
        void datasetService.ensure().catch(() => undefined)
        return reply.code(202).send({ parsing: true, status })
      }
      const config = await getConfig()
      return computeSummary(dataset, config)
    }),
  )

  app.get(
    '/api/config',
    guard(async () => {
      const config = await getConfig()
      const dataset = datasetService.get()
      const platforms = new Set<string>([...KNOWN_PLATFORMS, ...datasetService.platformNames()])
      for (const name of Object.keys(dataset?.ad.byPlatform ?? {})) platforms.add(normalizePlatform(name))
      return {
        config,
        meta: {
          platforms: [...platforms],
          orderPlatforms: datasetService.platformNames(),
          costColumnHeader: dataset?.cost.costColumnHeader ?? '',
          costRows: dataset?.cost.rows ?? 0,
          commissionConnected: dataset?.commissionConnected ?? false,
          refreshStatus: datasetService.getStatus(),
        },
      }
    }),
  )

  app.put(
    '/api/config',
    guard(async (request, reply) => {
      const parsed = configSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: zodMessage(parsed.error) })
      }
      const saved = await configStore.save(parsed.data, datasetService.platformNames())
      const dataset = datasetService.get()
      const summary = dataset ? computeSummary(dataset, saved) : null
      return { config: saved, summary }
    }),
  )

  app.get(
    '/api/status-pairs',
    guard(async (_request, reply) => {
      const dataset = datasetService.get()
      if (!dataset) return reply.code(202).send({ parsing: true, status: datasetService.getStatus() })
      const config = await getConfig()
      const summary = computeSummary(dataset, config)
      return { statusPairs: summary.statusPairs, status: datasetService.getStatus() }
    }),
  )

  app.put(
    '/api/status-pairs',
    guard(async (request, reply) => {
      const parsed = statusPairSetSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error) })
      const body = parsed.data
      const config = await getConfig()
      config.statusOverrides[body.platform] ??= {}
      config.statusOverrides[body.platform][pairKey(body.orderStatus, body.afterSaleStatus)] = body.classification
      const saved = await configStore.save(config, datasetService.platformNames())
      const dataset = datasetService.get()
      const summary = dataset ? computeSummary(dataset, saved) : null
      return { config: saved, summary }
    }),
  )

  app.delete(
    '/api/status-pairs',
    guard(async (request) => {
      const parsed = statusPairResetSchema.safeParse(request.body ?? {})
      if (!parsed.success) return { error: zodMessage(parsed.error) }
      const { platform, orderStatus, afterSaleStatus } = parsed.data
      const config = await getConfig()
      if (!platform) {
        config.statusOverrides = {}
      } else if (orderStatus !== undefined && afterSaleStatus !== undefined) {
        const bucket = config.statusOverrides[platform]
        if (bucket) {
          delete bucket[pairKey(orderStatus, afterSaleStatus)]
          if (!Object.keys(bucket).length) delete config.statusOverrides[platform]
        }
      } else {
        delete config.statusOverrides[platform]
      }
      const saved = await configStore.save(config, datasetService.platformNames())
      const dataset = datasetService.get()
      const summary = dataset ? computeSummary(dataset, saved) : null
      return { config: saved, summary }
    }),
  )

  app.post(
    '/api/config/preview',
    guard(async (request, reply) => {
      const parsed = configSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error) })
      const dataset = datasetService.get()
      if (!dataset) return reply.code(202).send({ parsing: true, status: datasetService.getStatus() })
      const config = normalizeConfig(parsed.data, datasetService.platformNames())
      // 仅预览：按草稿参数重算，不写入 data/config.json
      const cacheKey = JSON.stringify(config)
      const cached = previewCache.get(cacheKey)
      if (cached) return { summary: cached }
      const summary = computeSummary(dataset, config)
      previewCache.set(cacheKey, summary)
      if (previewCache.size > PREVIEW_CACHE_LIMIT) {
        const oldest = previewCache.keys().next().value
        if (oldest !== undefined) previewCache.delete(oldest)
      }
      return { summary }
    }),
  )

  app.get(
    '/api/costs/template.xlsx',
    guard(async (_request, reply) => {
      const dataset = datasetService.get()
      if (!dataset) return reply.code(409).send({ error: '数据尚未加载完成' })
      const config = await getConfig()
      const summary = computeSummary(dataset, config)
      const buffer = await buildCostTemplateWorkbook(
        summary.missingCosts.map((item) => ({
          sku: item.sku,
          productName: item.productName,
          suggestion: item.suggestion,
          platforms: item.platforms,
          settledQty: item.settledQty,
        })),
        dataset.cost.costColumnHeader || '成本价',
        summary.period,
      )
      const fileName = `缺失成本补录模板_${summary.period ?? new Date().toISOString().slice(0, 10)}.xlsx`
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      return reply.send(buffer)
    }),
  )

  app.post(
    '/api/costs/import',
    guard(async (request, reply) => {
      const parsed = costImportSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error) })
      const dataset = datasetService.get()
      if (!dataset) return reply.code(202).send({ parsing: true, status: datasetService.getStatus() })
      const base64 = parsed.data.dataBase64.replace(/^data:[^,]*,/, '')
      const buffer = Buffer.from(base64, 'base64')
      if (!buffer.length) return reply.code(400).send({ error: '文件内容为空' })
      if (buffer.length > 8 * 1024 * 1024) return reply.code(400).send({ error: '文件过大（超过 8MB）' })
      if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
        return reply.code(400).send({ error: '请上传 .xlsx 格式的 Excel 文件（不支持 .xls / CSV）' })
      }
      let result: Awaited<ReturnType<typeof parseCostWorkbook>>
      try {
        result = await parseCostWorkbook(buffer)
      } catch (error) {
        return reply.code(400).send({ error: `解析失败：${(error as Error).message}` })
      }

      // 校验 SKU 是否存在于订单或成本表中，避免把无关文件当补录数据
      const knownSkus = new Set<string>(Object.keys(dataset.cost.prices))
      for (const row of dataset.orders) {
        if (row.sku) knownSkus.add(row.sku)
      }
      const matched: typeof result.rows = []
      const unknown: typeof result.rows = []
      for (const row of result.rows) {
        if (knownSkus.has(row.sku)) matched.push(row)
        else unknown.push(row)
      }
      return {
        fileName: parsed.data.fileName ?? '',
        sheets: result.sheets,
        headerRow: result.headerRow,
        parsedRows: result.rows.length,
        matched,
        unknown: unknown.slice(0, 50),
        unknownCount: unknown.length,
        invalid: result.ignored.slice(0, 50),
        invalidCount: result.ignored.length,
        warnings: result.warnings,
      }
    }),
  )

  app.get(
    '/api/export.xlsx',
    guard(async (_request, reply) => {
      const dataset = datasetService.get()
      if (!dataset) return reply.code(409).send({ error: '数据尚未加载完成' })
      const config = await getConfig()
      const summary = computeSummary(dataset, config)
      const buffer = await buildExportWorkbook(summary, config)
      const fileName = `平台粗算毛利_${summary.period ?? new Date().toISOString().slice(0, 10)}.xlsx`
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      return reply.send(buffer)
    }),
  )

  const distDir = options.distDir
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        return reply.code(404).send({ error: '接口不存在' })
      }
      return reply.sendFile('index.html')
    })
  } else {
    app.log?.warn?.(`未找到前端目录 ${distDir}，仅提供 API`)
  }

  return app
}
