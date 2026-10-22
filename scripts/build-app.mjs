#!/usr/bin/env node
/**
 * 打包独立运行版（默认同时构建 macOS arm64 / macOS x64 / Windows x64）：
 *
 *   1. 构建前端（vite build）
 *   2. 用 esbuild 把服务端打包成单文件 build/app.cjs（含全部依赖）
 *   3. 下载官方 Node.js 运行时（保留其官方签名），与 app.cjs、dist/ 一起组装
 *   4. macOS 生成双击可运行的 ProfitScript.app 与 profit-script.command
 *   5. 输出带可执行权限的 zip 到 release/
 *
 * 配置/缓存与 Excel 源文件不放进安装包：打包运行时默认写入系统应用数据目录，
 * 升级只需替换程序目录，参数与缓存保留。
 *
 * 用法：
 *   node scripts/build-app.mjs                          # 全部平台
 *   node scripts/build-app.mjs --targets macos-arm64    # 只构建 macOS arm64
 *   node scripts/build-app.mjs --skip-web               # 复用已有 dist/
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { build as esbuild } from 'esbuild'

const NODE_VERSION = 'v22.14.0'
const ROOT = process.cwd()
const RELEASE_DIR = path.join(ROOT, 'release')
const BUILD_DIR = path.join(ROOT, 'build')
const CACHE_DIR = path.join(BUILD_DIR, 'cache')

const TARGETS = {
  'win-x64': {
    label: 'Windows x64',
    nodeArchive: `node-${NODE_VERSION}-win-x64.zip`,
    nodeVersionDir: `node-${NODE_VERSION}-win-x64`,
    nodeBinary: ['node.exe'],
    platform: 'win32',
  },
  'macos-arm64': {
    label: 'macOS arm64（Apple Silicon）',
    nodeArchive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeVersionDir: `node-${NODE_VERSION}-darwin-arm64`,
    nodeBinary: ['bin', 'node'],
    platform: 'darwin',
    arch: 'arm64',
  },
  'macos-x64': {
    label: 'macOS x64（Intel）',
    nodeArchive: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
    nodeVersionDir: `node-${NODE_VERSION}-darwin-x64`,
    nodeBinary: ['bin', 'node'],
    platform: 'darwin',
    arch: 'x64',
  },
}

function parseArgs(argv) {
  const options = { targets: Object.keys(TARGETS), skipWeb: false, noZip: false, nodeVersion: NODE_VERSION }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--targets') {
      options.targets = String(argv[++index])
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    } else if (arg.startsWith('--targets=')) {
      options.targets = arg.slice('--targets='.length).split(',').map((item) => item.trim())
    } else if (arg === '--skip-web') options.skipWeb = true
    else if (arg === '--no-zip') options.noZip = true
    else if (arg === '--node-version') options.nodeVersion = String(argv[++index])
  }
  for (const target of options.targets) {
    if (!TARGETS[target]) throw new Error(`未知目标 ${target}，可选：${Object.keys(TARGETS).join(', ')}`)
  }
  return options
}

async function pathExists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function copyDir(source, destination) {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await copyDir(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  const file = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command
  execFileSync(file, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm' })
}

async function download(url, destination) {
  if (await pathExists(destination)) return destination
  await mkdir(path.dirname(destination), { recursive: true })
  console.log(`下载 ${url}`)
  const partial = `${destination}.partial`
  await rm(partial, { force: true })
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
  try {
    execFileSync(
      curl,
      ['-L', '--fail', '--retry', '4', '--retry-delay', '2', '--connect-timeout', '60', '--max-time', '1200', '-sS', '-o', partial, url],
      { stdio: 'inherit' },
    )
  } catch {
    // curl 不可用时退回 fetch
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`下载失败 ${response.status} ${url}`)
    await writeFile(partial, Buffer.from(await response.arrayBuffer()))
  }
  const info = await stat(partial)
  if (info.size < 10 * 1024 * 1024) throw new Error(`下载文件过小（${info.size} 字节）：${url}`)
  await rename(partial, destination)
  console.log(`已保存 ${destination}（${(info.size / 1024 / 1024).toFixed(1)} MB）`)
  return destination
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath))
}

async function walkFiles(rootDir, current = rootDir, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) await walkFiles(rootDir, full, result)
    else if (entry.isFile()) result.push(path.relative(rootDir, full).split(path.sep).join('/'))
  }
  return result
}

async function zipFolder(folder, zipPath, executableRelPaths) {
  await mkdir(path.dirname(zipPath), { recursive: true })
  const baseName = path.basename(folder)
  const files = await walkFiles(folder)
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') reject(error)
    })
    archive.pipe(output)
    for (const relative of files) {
      const mode = executableRelPaths.has(relative) ? 0o755 : 0o644
      archive.file(path.join(folder, relative), { name: `${baseName}/${relative}`, mode })
    }
    archive.finalize()
  })
}

/** 读取 zip 中央目录，校验关键文件是否带 0755 可执行位（macOS 解压后需要） */
async function inspectZip(zipPath) {
  const buffer = await readFile(zipPath)
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

async function extractNode(target, options) {
  const config = TARGETS[target]
  const archiveName = config.nodeArchive.replace(NODE_VERSION, options.nodeVersion)
  const url = `https://nodejs.org/dist/${options.nodeVersion}/${archiveName}`
  const archivePath = path.join(CACHE_DIR, archiveName)
  await download(url, archivePath)
  const versionDir = config.nodeVersionDir.replace(NODE_VERSION, options.nodeVersion)
  const extractRoot = path.join(CACHE_DIR, `extract-${versionDir}`)
  const binaryPath = path.join(extractRoot, versionDir, ...config.nodeBinary)
  if (!(await pathExists(binaryPath))) {
    await rm(extractRoot, { recursive: true, force: true })
    await mkdir(extractRoot, { recursive: true })
    console.log(`解压 ${archiveName}`)
    // 只取 node 可执行文件：macOS 发行包里的 npm/npx/corepack 是符号链接，Windows 解压会失败
    const member = `${versionDir}/${config.nodeBinary.join('/')}`
    execFileSync('tar', ['-xf', archivePath, '-C', extractRoot, member], { stdio: 'inherit' })
  }
  if (!(await pathExists(binaryPath))) throw new Error(`未找到 Node 运行时：${binaryPath}`)
  return binaryPath
}

const MAC_LAUNCHER = `#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/app.cjs" --packaged "$@"
`

const MAC_APP_LAUNCHER = `#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
exec "$DIR/node" "$DIR/app.cjs" --packaged "$@"
`

const WIN_LAUNCHER = `@echo off
setlocal
"%~dp0node.exe" "%~dp0app.cjs" --packaged %*
if errorlevel 1 pause
`

function macReadme(version, targetLabel) {
  return `毛利·粗算面板 v${version} — ${targetLabel}
================================================

一、首次运行（macOS 会隔离从网络下载的文件，需要先解除一次）
  方式 A：双击打开
    1. 解压 zip；
    2. 打开「终端」，进入解压出的目录，执行：
         xattr -dr com.apple.quarantine ProfitScript.app
    3. 双击 ProfitScript.app，浏览器会自动打开面板（默认 http://127.0.0.1:8787）。
       若仍提示无法验证开发者：右键应用 → 打开 → 仍要打开，或到
       「系统设置 → 隐私与安全性」中点「仍要打开」。

  方式 B：命令行启动（不经过 .app）
    终端进入解压目录后执行：
         chmod +x node profit-script.command
         ./profit-script.command

二、源文件与数据目录（不随安装包分发）
  首次启动会在以下位置创建目录：
    ~/Library/Application Support/ProfitScript/excel/    ← 把 Excel 源文件放这里
       订单源/ 成本表/ 月消耗表/ 商务订单/
    ~/Library/Application Support/ProfitScript/data/     ← 参数与缓存（升级保留）
       config.json  人工参数、补录成本、状态归类
       cache/       解析缓存，可删除后重新解析

  也可以用参数或环境变量指定其他目录：
    ./profit-script.command --home /Users/you/ProfitScript --port 8787
    PROFIT_SCRIPT_HOME=/Users/you/ProfitScript ./profit-script.command

三、升级
  解压新版本替换程序目录即可；不要删除上面的数据目录，参数和缓存会继续使用。
  停止运行：关闭面板所在终端，或在「活动监视器」中结束 ProfitScript / node 进程。

四、说明
  - 安装包内使用的是 Node.js 官方运行时（未修改、保留官方签名），只包含打包后的
    程序与前端静态文件；不包含 excel/ 源文件与 data/ 缓存。
  - 若公司电脑限制运行第三方程序，请让 IT 按需签名/放行。
`
}

function winReadme(version, targetLabel) {
  return `毛利·粗算面板 v${version} — ${targetLabel}
================================================

一、运行
  解压 zip 后双击 profit-script.cmd，或在该目录执行：
      profit-script.cmd
  启动后浏览器会自动打开 http://127.0.0.1:8787 。

二、源文件与数据目录（不随安装包分发）
  首次启动会在以下位置创建目录：
    %APPDATA%\\ProfitScript\\excel\\    ← 把 Excel 源文件放这里
       订单源\\ 成本表\\ 月消耗表\\ 商务订单\\
    %APPDATA%\\ProfitScript\\data\\     ← 参数与缓存（升级保留）

  也可以指定其他目录：
    profit-script.cmd --home D:\\ProfitScript --port 8787

三、升级
  解压新版本替换程序目录即可，保留上面的数据目录（参数与缓存）。
`
}

async function buildServerBundle() {
  await mkdir(BUILD_DIR, { recursive: true })
  console.log('\n打包服务端（esbuild → build/app.cjs）')
  await esbuild({
    entryPoints: [path.join(ROOT, 'server/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(BUILD_DIR, 'app.cjs'),
    external: ['@aws-sdk/client-s3', '@aws-sdk/lib-storage'],
    legalComments: 'none',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const size = (await stat(path.join(BUILD_DIR, 'app.cjs'))).size
  console.log(`build/app.cjs ${(size / 1024 / 1024).toFixed(2)} MB`)
}

function macInfoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleExecutable</key>
  <string>ProfitScript</string>
  <key>CFBundleIdentifier</key>
  <string>com.profit-script.desktop</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>ProfitScript</string>
  <key>CFBundleDisplayName</key>
  <string>毛利 · 粗算面板</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`
}

async function assembleTarget(target, nodeBinaryPath, version) {
  const config = TARGETS[target]
  const folderName = `profit-script-v${version}-${target}`
  const appDir = path.join(RELEASE_DIR, folderName)
  await rm(appDir, { recursive: true, force: true })
  await mkdir(appDir, { recursive: true })

  await copyFile(path.join(BUILD_DIR, 'app.cjs'), path.join(appDir, 'app.cjs'))
  await copyDir(path.join(ROOT, 'dist'), path.join(appDir, 'dist'))

  const executableRelPaths = new Set()
  if (config.platform === 'darwin') {
    await copyFile(nodeBinaryPath, path.join(appDir, 'node'))
    await writeFile(path.join(appDir, 'profit-script.command'), MAC_LAUNCHER, 'utf8')
    await writeFile(path.join(appDir, 'README-运行说明.txt'), macReadme(version, config.label), 'utf8')

    // 双击运行的 .app（内部使用官方 node + 打包后的 app.cjs）
    const appBundle = path.join(appDir, 'ProfitScript.app')
    const resources = path.join(appBundle, 'Contents', 'Resources')
    const macosDir = path.join(appBundle, 'Contents', 'MacOS')
    await mkdir(resources, { recursive: true })
    await mkdir(macosDir, { recursive: true })
    await copyFile(nodeBinaryPath, path.join(resources, 'node'))
    await copyFile(path.join(BUILD_DIR, 'app.cjs'), path.join(resources, 'app.cjs'))
    await copyDir(path.join(ROOT, 'dist'), path.join(resources, 'dist'))
    await writeFile(path.join(appBundle, 'Contents', 'Info.plist'), macInfoPlist(version), 'utf8')
    await writeFile(path.join(macosDir, 'ProfitScript'), MAC_APP_LAUNCHER, 'utf8')

    executableRelPaths.add('node')
    executableRelPaths.add('profit-script.command')
    executableRelPaths.add('ProfitScript.app/Contents/MacOS/ProfitScript')
    executableRelPaths.add('ProfitScript.app/Contents/Resources/node')
  } else {
    await copyFile(nodeBinaryPath, path.join(appDir, 'node.exe'))
    await writeFile(path.join(appDir, 'profit-script.cmd'), WIN_LAUNCHER, 'utf8')
    await writeFile(path.join(appDir, 'README-运行说明.txt'), winReadme(version, config.label), 'utf8')
  }

  const zipPath = path.join(RELEASE_DIR, `${folderName}.zip`)
  await rm(zipPath, { force: true })
  await zipFolder(appDir, zipPath, executableRelPaths)
  const entries = await inspectZip(zipPath)
  const checks = [...executableRelPaths].map((relative) => {
    const entry = entries.find((item) => item.name.endsWith(`/${relative}`))
    return { relative, mode: entry?.mode ?? 0, ok: (entry?.mode ?? 0) === 0o755 }
  })
  const allExecutable = checks.every((item) => item.ok)
  if (!allExecutable) {
    throw new Error(`zip 可执行位校验失败：${JSON.stringify(checks.filter((item) => !item.ok))}`)
  }
  const zipSize = (await stat(zipPath)).size
  return {
    target,
    label: config.label,
    folder: appDir,
    zip: zipPath,
    zipSize,
    executableChecks: checks,
    sha256: await sha256File(zipPath),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const versionSource = await readFile(path.join(ROOT, 'shared/version.ts'), 'utf8')
  const appVersion = versionSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1]
  if (!appVersion) throw new Error('无法从 shared/version.ts 读取 APP_VERSION')
  if (pkg.version !== appVersion) throw new Error(`版本号不一致：package.json=${pkg.version} 应用=${appVersion}`)
  console.log(`打包版本 v${appVersion}，目标：${options.targets.map((target) => TARGETS[target].label).join(' / ')}`)

  if (!options.skipWeb) run('npm', ['run', 'build'])
  await buildServerBundle()

  // 先用系统 node 快速验证打包后的服务端可启动（避免把坏包发出去）
  run('node', [path.join(BUILD_DIR, 'app.cjs'), '--help'])

  const results = []
  for (const target of options.targets) {
    const nodeBinaryPath = await extractNode(target, options)
    const result = await assembleTarget(target, nodeBinaryPath, appVersion)
    results.push(result)
    console.log(
      `✓ ${result.label}: ${path.basename(result.zip)}（${(result.zipSize / 1024 / 1024).toFixed(1)} MB，sha256 ${result.sha256.slice(0, 16)}…）`,
    )
  }

  const manifest = {
    name: 'profit-script',
    version: appVersion,
    nodeVersion: options.nodeVersion,
    builtAt: new Date().toISOString(),
    artifacts: results.map((item) => ({
      target: item.target,
      label: item.label,
      zip: path.basename(item.zip),
      size: item.zipSize,
      sha256: item.sha256,
    })),
  }
  await writeFile(path.join(RELEASE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`\n完成，产物在 ${RELEASE_DIR}`)
}

main().catch((error) => {
  console.error(error)
  console.error(`\n打包失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
