import { readdir } from 'node:fs/promises'
import path from 'node:path'

/** 源文件目录中不参与解析的文件夹关键字（例如用户放入的历史订单/消耗数据） */
export const IGNORED_SOURCE_KEYWORD = '历史数据'

export function isIgnoredSourceName(name: string): boolean {
  return Boolean(name) && name.includes(IGNORED_SOURCE_KEYWORD)
}

/** 路径中任意一段目录名包含「历史数据」即视为忽略（支持 -历史数据 等前缀写法） */
export function isIgnoredSourcePath(target: string): boolean {
  if (!target) return false
  return target.split(/[\\/]+/).some((segment) => isIgnoredSourceName(segment))
}

async function countXlsxInDir(dir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let count = 0
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) count += await countXlsxInDir(fullPath)
    else if (/\.xlsx$/i.test(entry.name) && !entry.name.startsWith('~$')) count += 1
  }
  return count
}

/** 统计 excel/ 下「历史数据」类文件夹里的 Excel 数量，用于在面板提示已忽略 */
export async function countIgnoredExcelFiles(excelDir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(excelDir, { withFileTypes: true })
  } catch {
    return 0
  }
  let count = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (isIgnoredSourceName(entry.name)) {
      count += await countXlsxInDir(path.join(excelDir, entry.name))
    } else {
      // 也兼容放在子目录里的历史数据文件夹（如 订单源/历史数据）
      const nested = path.join(excelDir, entry.name, IGNORED_SOURCE_KEYWORD)
      count += await countXlsxInDir(nested)
    }
  }
  return count
}
