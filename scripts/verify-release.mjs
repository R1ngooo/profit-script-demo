#!/usr/bin/env node
/**
 * 校验 release/ 下的安装包结构（不执行目标平台程序）：
 * - 目录/文件完整性、manifest 版本与 SHA-256
 * - macOS：Mach-O 头（arm64 / x86_64）、Info.plist 版本、启动脚本 LF/shebang
 * - zip 中央目录里的可执行位（node / 启动脚本需 0755，macOS 解压后可直接运行）
 *
 * 用法：node scripts/verify-release.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const RELEASE = path.join(ROOT, 'release')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

function zipCentralEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath)
  let eocd = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65535); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error(`不是有效 zip：${zipPath}`)
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const externalAttributes = buffer.readUInt32LE(offset + 38)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, mode: (externalAttributes >>> 16) & 0o777 })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function executableModeOk(entries, suffix, label) {
  const entry = entries.find((item) => item.name.endsWith(`/${suffix}`))
  const ok = (entry?.mode ?? 0) === 0o755
  console.log(`  ${ok ? '✓' : '✗'} ${label} 权限 ${entry ? entry.mode.toString(8) : '(缺失)'}（期望 755）`)
  if (!ok) throw new Error(`${label} 可执行位异常`)
}

const manifestPath = path.join(RELEASE, 'manifest.json')
if (!fs.existsSync(manifestPath)) throw new Error('缺少 release/manifest.json，请先运行 npm run package:app')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest.version !== VERSION) throw new Error(`manifest 版本 ${manifest.version} ≠ package.json ${VERSION}`)
console.log(`release 版本 v${manifest.version}，产物 ${manifest.artifacts.length} 个`)

for (const artifact of manifest.artifacts) {
  const zipPath = path.join(RELEASE, artifact.zip)
  const folder = zipPath.replace(/\.zip$/, '')
  const folderName = path.basename(folder)
  console.log(`\n[${artifact.label}] ${artifact.zip}`)
  if (!fs.existsSync(zipPath)) throw new Error(`缺少 ${artifact.zip}`)
  if (!fs.existsSync(folder)) throw new Error(`缺少解压目录 ${folderName}`)
  const size = fs.statSync(zipPath).size
  console.log(`  大小 ${(size / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  sha256 ${artifact.sha256}`)

  for (const required of ['app.cjs', 'dist/index.html']) {
    if (!fs.existsSync(path.join(folder, required))) throw new Error(`${folderName} 缺少 ${required}`)
  }
  const entries = zipCentralEntries(zipPath)

  if (artifact.target.startsWith('macos')) {
    const plist = fs.readFileSync(path.join(folder, 'ProfitScript.app/Contents/Info.plist'), 'utf8')
    const plistVersion = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
    if (plistVersion !== VERSION) throw new Error(`Info.plist 版本 ${plistVersion} ≠ ${VERSION}`)
    const launcher = fs.readFileSync(path.join(folder, 'profit-script.command'), 'utf8')
    if (!launcher.startsWith('#!/bin/bash') || launcher.includes('\r')) throw new Error('profit-script.command 格式异常')
    const nodeBuffer = fs.readFileSync(path.join(folder, 'node'))
    const magic = nodeBuffer.readUInt32LE(0)
    const cpu = nodeBuffer.readUInt32LE(4)
    const cpuName = cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x86_64' : `0x${cpu.toString(16)}`
    if (magic !== 0xfeedfacf) throw new Error('node 不是 Mach-O 64 可执行文件')
    console.log(`  ✓ Mach-O: ${cpuName}，Info.plist 版本 ${plistVersion}`)
    executableModeOk(entries, 'node', 'node')
    executableModeOk(entries, 'profit-script.command', 'profit-script.command')
    executableModeOk(entries, 'ProfitScript.app/Contents/MacOS/ProfitScript', 'ProfitScript.app 启动脚本')
    executableModeOk(entries, 'ProfitScript.app/Contents/Resources/node', 'ProfitScript.app 内 node')
    console.log('  ℹ macOS 包未在真实 macOS 上执行；首次运行请先 xattr -dr com.apple.quarantine ProfitScript.app')
  } else {
    for (const file of ['node.exe', 'profit-script.cmd', 'README-运行说明.txt']) {
      if (!fs.existsSync(path.join(folder, file))) throw new Error(`${folderName} 缺少 ${file}`)
    }
    console.log('  ✓ Windows 便携版结构完整')
  }
}

console.log('\n全部安装包结构校验通过')
