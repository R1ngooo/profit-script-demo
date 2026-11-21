import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { countIgnoredExcelFiles, isIgnoredSourceName, isIgnoredSourcePath } from '../../server/util/sourceFilter'
import { discoverCommissionFiles } from '../../server/readers/commissionSource'

const tempDirs: string[] = []

async function tempExcelDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'profit-source-'))
  tempDirs.push(root)
  const excelDir = path.join(root, 'excel')
  await mkdir(excelDir, { recursive: true })
  return excelDir
}

async function touch(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, '')
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('历史数据文件夹忽略', () => {
  it('识别名称与路径（兼容 -历史数据、子目录、Windows 分隔符）', () => {
    expect(isIgnoredSourceName('历史数据')).toBe(true)
    expect(isIgnoredSourceName('-历史数据')).toBe(true)
    expect(isIgnoredSourceName('9月份商务订单')).toBe(false)
    expect(isIgnoredSourcePath('excel/-历史数据/9月抖音订单.xlsx')).toBe(true)
    expect(isIgnoredSourcePath('excel\\订单源\\历史数据\\a.xlsx')).toBe(true)
    expect(isIgnoredSourcePath('excel/订单源/10月抖音订单.xlsx')).toBe(false)
  })

  it('达人佣金目录扫描跳过历史数据子目录', async () => {
    const excelDir = await tempExcelDir()
    await touch(path.join(excelDir, '商务订单', '快手订单.xlsx'))
    await touch(path.join(excelDir, '商务订单', '历史数据', '9月快手订单.xlsx'))
    await touch(path.join(excelDir, '9月份商务订单', '视频号订单.xlsx'))
    await touch(path.join(excelDir, '-历史数据', '商务订单', '旧商务订单.xlsx'))

    const files = await discoverCommissionFiles(excelDir)
    const names = files.map((file) => path.basename(file)).sort()
    expect(names).toEqual(['快手订单.xlsx', '视频号订单.xlsx'])
  })

  it('统计历史数据目录内的 Excel 数量（含嵌套子目录）', async () => {
    const excelDir = await tempExcelDir()
    await touch(path.join(excelDir, '-历史数据', '9月抖音订单.xlsx'))
    await touch(path.join(excelDir, '-历史数据', '2026.9月', '9月快手订单.xlsx'))
    await touch(path.join(excelDir, '订单源', '历史数据', '旧订单.xlsx'))
    await touch(path.join(excelDir, '订单源', '10月抖音订单.xlsx'))
    await touch(path.join(excelDir, '商务订单', '视频号订单.xlsx'))

    expect(await countIgnoredExcelFiles(excelDir)).toBe(3)
  })
})
