import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import { SaxesParser } from 'saxes'

function localName(name: string): string {
  const index = name.lastIndexOf(':')
  return index >= 0 ? name.slice(index + 1) : name
}

/** 把 Node 流喂给 saxes（按 UTF-8 解码，避免多字节字符被切断） */
export async function feedSaxes(stream: Readable, parser: SaxesParser): Promise<void> {
  const decoder = new StringDecoder('utf8')
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      try {
        parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk))
      } catch (error) {
        reject(error)
        stream.destroy()
      }
    })
    stream.on('end', () => {
      try {
        const rest = decoder.end()
        if (rest) parser.write(rest)
        parser.close()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    stream.on('error', (error) => reject(error))
  })
}

function createSharedStringParser(strings: string[]): SaxesParser {
  const parser = new SaxesParser({ xmlns: false })
  let inSi = false
  let inText = false
  let buffer = ''
  parser.on('opentag', (tag) => {
    const name = localName(tag.name)
    if (name === 'si') {
      inSi = true
      buffer = ''
    } else if (name === 't' && inSi) {
      inText = true
    }
  })
  parser.on('text', (text) => {
    if (inText) buffer += text
  })
  parser.on('closetag', (tag) => {
    const name = localName(tag.name)
    if (name === 't') inText = false
    if (name === 'si') {
      strings.push(buffer)
      inSi = false
      buffer = ''
    }
  })
  return parser
}

/** 加载共享字符串表（视频号约 40 万条） */
export async function loadSharedStrings(stream: Readable): Promise<string[]> {
  const strings: string[] = []
  const parser = createSharedStringParser(strings)
  await feedSaxes(stream, parser)
  return strings
}
