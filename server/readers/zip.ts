import unzipper from 'unzipper'
import type { Readable } from 'node:stream'

export interface ZipEntryLike {
  path: string
  stream(): Readable
  buffer(): Promise<Buffer>
}

export interface Workbook {
  filePath: string
  entries: ZipEntryLike[]
  entry(path: string): ZipEntryLike | undefined
}

function normalizeEntryPath(input: string): string {
  return input.replace(/^\/+/, '')
}

export async function openWorkbook(filePath: string): Promise<Workbook> {
  const directory = (await unzipper.Open.file(filePath)) as unknown as { files: ZipEntryLike[] }
  const entries = directory.files.map((entry) => {
    entry.path = normalizeEntryPath(entry.path)
    return entry
  })
  const map = new Map<string, ZipEntryLike>(entries.map((entry) => [entry.path, entry]))
  return {
    filePath,
    entries,
    entry: (target: string) => map.get(normalizeEntryPath(target)),
  }
}

export async function readEntryText(workbook: Workbook, entryPath: string): Promise<string> {
  const entry = workbook.entry(entryPath)
  if (!entry) throw new Error(`压缩包内缺少文件：${entryPath}`)
  const buffer = await entry.buffer()
  return buffer.toString('utf8')
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="([^"]*)"`))
  return match ? match[1] : ''
}

export interface SheetLocation {
  name: string
  path: string
}

/** 列出工作簿中的所有 sheet 名称与对应 xml 路径 */
export async function listSheets(workbook: Workbook): Promise<SheetLocation[]> {
  const workbookXml = await readEntryText(workbook, 'xl/workbook.xml')
  const relsXml = await readEntryText(workbook, 'xl/_rels/workbook.xml.rels')

  const relTargets = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0]
    const id = attr(tag, 'Id')
    const target = attr(tag, 'Target')
    if (id && target) relTargets.set(id, target)
  }

  const sheets: SheetLocation[] = []
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0]
    const name = attr(tag, 'name')
    const rid = attr(tag, 'r:id')
    const target = relTargets.get(rid)
    if (!name || !target) continue
    const normalized = normalizeEntryPath(target)
    const path = normalized.startsWith('xl/') ? normalized : `xl/${normalized}`
    sheets.push({ name, path })
  }
  return sheets
}

export async function findSheet(workbook: Workbook, sheetName: string): Promise<SheetLocation> {
  const sheets = await listSheets(workbook)
  const found = sheets.find((sheet) => sheet.name.trim() === sheetName.trim())
  if (!found) {
    const names = sheets.map((sheet) => `「${sheet.name}」`).join('、') || '（无）'
    throw new Error(`未找到名为「${sheetName}」的 Sheet，当前工作簿包含：${names}`)
  }
  return found
}
