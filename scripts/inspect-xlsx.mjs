/**
 * 开发辅助脚本：打印 xlsx 每个 sheet 的前 N 行（用于摸清数据源结构）。
 * 用法：node scripts/inspect-xlsx.mjs <file> [maxRows]
 */
import { StringDecoder } from 'node:string_decoder'
import unzipper from 'unzipper'
import { SaxesParser } from 'saxes'

const file = process.argv[2]
const maxRows = Number(process.argv[3] ?? 4)
if (!file) {
  console.error('用法: node scripts/inspect-xlsx.mjs <xlsx> [maxRows]')
  process.exit(1)
}

const zip = await unzipper.Open.file(file)
const entries = new Map(zip.files.map((entry) => [entry.path.replace(/^\/+/, ''), entry]))
const readText = async (name) => {
  const entry = entries.get(name)
  if (!entry) return null
  return (await entry.buffer()).toString('utf8')
}

function localName(name) {
  const index = name.lastIndexOf(':')
  return index >= 0 ? name.slice(index + 1) : name
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="([^"]*)"`))
  return match ? match[1] : ''
}

async function feed(stream, parser) {
  const decoder = new StringDecoder('utf8')
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk)))
    stream.on('end', () => {
      parser.write(decoder.end())
      parser.close()
      resolve()
    })
    stream.on('error', reject)
  })
}

// 共享字符串
const shared = []
const ssEntry = entries.get('xl/sharedStrings.xml')
if (ssEntry) {
  const parser = new SaxesParser({ xmlns: false })
  let inSi = false
  let inText = false
  let buffer = ''
  parser.on('opentag', (tag) => {
    const name = localName(tag.name)
    if (name === 'si') {
      inSi = true
      buffer = ''
    } else if (name === 't' && inSi) inText = true
  })
  parser.on('text', (text) => {
    if (inText) buffer += text
  })
  parser.on('closetag', (tag) => {
    const name = localName(tag.name)
    if (name === 't') inText = false
    if (name === 'si') {
      shared.push(buffer)
      inSi = false
    }
  })
  await feed(ssEntry.stream(), parser)
}

const workbookXml = await readText('xl/workbook.xml')
const relsXml = await readText('xl/_rels/workbook.xml.rels')
const relTargets = new Map()
for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
  relTargets.set(attr(match[0], 'Id'), attr(match[0], 'Target'))
}
const sheets = []
for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
  const name = attr(match[0], 'name')
  const rid = attr(match[0], 'r:id')
  const target = relTargets.get(rid)
  if (!name || !target) continue
  const normalized = target.replace(/^\/+/, '')
  sheets.push({ name, path: normalized.startsWith('xl/') ? normalized : `xl/${normalized}` })
}

console.log(`文件: ${file}`)
console.log(`sheets: ${sheets.map((sheet) => sheet.name).join(' | ')}`)

for (const sheet of sheets) {
  const entry = entries.get(sheet.path)
  if (!entry) continue
  const rows = []
  const parser = new SaxesParser({ xmlns: false })
  let cells = {}
  let currentRow = 0
  let cellLetter = ''
  let cellType = 'n'
  let inValue = false
  let buffer = ''
  parser.on('opentag', (tag) => {
    const name = localName(tag.name)
    if (name === 'row') {
      currentRow = Number(tag.attributes.r ?? 0)
      cells = {}
    } else if (name === 'c') {
      const ref = tag.attributes.r ?? ''
      cellLetter = (/^([A-Z]+)/.exec(ref) ?? [])[1] ?? ''
      cellType = tag.attributes.t ?? 'n'
      inValue = false
      buffer = ''
    } else if (name === 'v' || name === 't') inValue = true
  })
  parser.on('text', (text) => {
    if (inValue) buffer += text
  })
  parser.on('closetag', (tag) => {
    const name = localName(tag.name)
    if (name === 'v' || name === 't') {
      inValue = false
      return
    }
    if (name === 'c') {
      let value = buffer
      if (cellType === 's' && value !== '') value = shared[Number(value)] ?? ''
      if (value !== '') cells[cellLetter] = value
      return
    }
    if (name === 'row') {
      if (rows.length < maxRows) rows.push({ row: currentRow, cells: { ...cells } })
    }
  })
  await feed(entry.stream(), parser)
  console.log(`\n--- sheet「${sheet.name}」 (${sheet.path})`)
  if (rows[0]) {
    console.log('  HEADER: ' + Object.entries(rows[0].cells).map(([letter, value]) => `${letter}=${value}`).join(' | '))
  }
  for (const row of rows) {
    console.log(`  row ${row.row}:`)
    for (const [letter, value] of Object.entries(row.cells)) {
      console.log(`    ${letter} = ${String(value).slice(0, 80)}`)
    }
  }
}
