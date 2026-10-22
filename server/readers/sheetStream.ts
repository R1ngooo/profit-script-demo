import type { Readable } from 'node:stream'
import { SaxesParser } from 'saxes'
import { feedSaxes } from './sharedStrings'

export interface SheetRow {
  row: number
  cells: Record<string, string>
}

export interface StreamSheetOptions {
  sharedStrings: string[]
  /** 只保留这些列（列字母），不传则保留全部 */
  columns?: Set<string>
  onRow: (row: SheetRow) => void
  /** 最多处理多少行（含表头），用于调试 */
  maxRows?: number
}

export interface StreamSheetResult {
  rowCount: number
  cellCount: number
}

function localName(name: string): string {
  const index = name.lastIndexOf(':')
  return index >= 0 ? name.slice(index + 1) : name
}

function columnLetterFromRef(ref: string): string {
  const match = /^([A-Z]+)/.exec(ref)
  return match ? match[1] : ''
}

/**
 * 流式解析 worksheet xml，只把需要的列落地，避免把 169MB 的 XML 读进内存。
 */
export async function streamSheetRows(stream: Readable, options: StreamSheetOptions): Promise<StreamSheetResult> {
  const { sharedStrings, columns, onRow, maxRows } = options
  const parser = new SaxesParser({ xmlns: false })

  let currentRowNumber = 0
  let cells: Record<string, string> = {}
  let rowCount = 0
  let cellCount = 0
  let needCell = false
  let cellType = 'n'
  let cellLetter = ''
  let inValue = false
  let buffer = ''
  let stopped = false

  const resetCell = () => {
    needCell = false
    cellType = 'n'
    cellLetter = ''
    inValue = false
    buffer = ''
  }

  parser.on('opentag', (tag) => {
    const name = localName(tag.name)
    if (name === 'row') {
      currentRowNumber = Number(tag.attributes.r ?? 0) || currentRowNumber + 1
      cells = {}
      return
    }
    if (name === 'c') {
      const ref = tag.attributes.r ?? ''
      cellLetter = columnLetterFromRef(ref)
      needCell = !columns || columns.has(cellLetter)
      cellType = (tag.attributes.t as string | undefined) ?? 'n'
      inValue = false
      buffer = ''
      return
    }
    if (needCell && (name === 'v' || name === 't')) {
      inValue = true
    }
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
      if (needCell && cellLetter) {
        let value = buffer
        if (cellType === 's' && value !== '') {
          const index = Number(value)
          value = Number.isFinite(index) ? (sharedStrings[index] ?? '') : ''
        }
        if (value !== '') {
          cells[cellLetter] = value
          cellCount += 1
        }
      }
      resetCell()
      return
    }
    if (name === 'row') {
      rowCount += 1
      if (!maxRows || rowCount <= maxRows) {
        onRow({ row: currentRowNumber, cells })
      } else if (!stopped) {
        stopped = true
        stream.destroy()
      }
    }
  })

  await feedSaxes(stream, parser)
  return { rowCount, cellCount }
}
