import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import path from 'node:path'

export interface CacheMeta {
  size: number
  mtimeMs: number
  appVersion: string
  [key: string]: unknown
}

/** 缓存格式版本：与程序版本解耦，避免升级应用时无谓地丢弃缓存 */
const CACHE_VERSION = '1.1.0'

export function cacheKey(filePath: string): string {
  return createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16)
}

export function cacheDir(dataDir: string): string {
  return path.join(dataDir, 'cache')
}

export async function fileFingerprint(filePath: string): Promise<{ size: number; mtimeMs: number }> {
  const info = await stat(filePath)
  return { size: info.size, mtimeMs: info.mtimeMs }
}

export async function readCache<T>(dataDir: string, filePath: string, kind: string): Promise<T | null> {
  const target = path.join(cacheDir(dataDir), `${kind}-${cacheKey(filePath)}.json.gz`)
  try {
    const buffer = await readFile(target)
    const payload = JSON.parse(gunzipSync(buffer).toString('utf8')) as { meta: CacheMeta; data: T }
    const fingerprint = await fileFingerprint(filePath)
    if (
      payload?.meta?.size !== fingerprint.size ||
      payload?.meta?.mtimeMs !== fingerprint.mtimeMs ||
      payload?.meta?.appVersion !== CACHE_VERSION
    ) {
      return null
    }
    return payload.data
  } catch {
    return null
  }
}

export async function writeCache<T>(dataDir: string, filePath: string, kind: string, data: T): Promise<void> {
  const dir = cacheDir(dataDir)
  await mkdir(dir, { recursive: true })
  const fingerprint = await fileFingerprint(filePath)
  const target = path.join(dir, `${kind}-${cacheKey(filePath)}.json.gz`)
  const tmp = `${target}.tmp`
  const payload = { meta: { ...fingerprint, appVersion: CACHE_VERSION }, data }
  await writeFile(tmp, gzipSync(Buffer.from(JSON.stringify(payload), 'utf8')))
  await rename(tmp, target)
}

export function cacheVersion(): string {
  return CACHE_VERSION
}
