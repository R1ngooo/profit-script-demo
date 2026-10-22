#!/usr/bin/env node
/**
 * 一键启动毛利·粗算面板（开发/源码方式运行）。
 *
 *   node scripts/start-app.mjs                 # 启动并自动打开浏览器（默认 8787）
 *   node scripts/start-app.mjs --no-open       # 只启动，不打开浏览器
 *   node scripts/start-app.mjs --port 8788     # 指定端口
 *   node scripts/start-app.mjs --home <目录>   # 指定数据目录（参数 + 缓存）
 *
 * Windows 可双击根目录「启动应用.cmd」，macOS 可双击「启动应用.command」。
 * 首次运行会自动安装依赖并构建前端；退出按 Ctrl+C。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const isWindows = process.platform === 'win32'

function printHelp() {
  console.log(
    [
      '毛利·粗算面板 启动脚本',
      '',
      '用法：',
      '  node scripts/start-app.mjs [选项]',
      '',
      '选项：',
      '  --port <端口>    监听端口（默认 8787）',
      '  --no-open        启动后不自动打开浏览器',
      '  --home <目录>    数据目录（config.json 与 cache/ 所在目录）',
      '  --excel <目录>   Excel 源文件目录（默认 <数据目录>/excel）',
      '  --help           显示本帮助',
      '',
      'Windows 可双击「启动应用.cmd」；macOS 可在终端运行：',
      '  chmod +x 启动应用.command && ./启动应用.command',
    ].join('\n'),
  )
}

function readFlag(name, fallback) {
  const index = args.findIndex((arg) => arg === name)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  return fallback
}

if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

const port = Number(readFlag('--port', process.env.PORT ?? 8787))
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`端口无效：${readFlag('--port', process.env.PORT ?? 8787)}`)
  process.exit(1)
}
const noOpen = args.includes('--no-open') || process.env.PROFIT_SCRIPT_NO_OPEN === '1'
const url = `http://127.0.0.1:${port}`

const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  console.error(`当前 Node.js 版本为 ${process.versions.node}，需要 20 或更高版本。`)
  console.error('请升级 Node.js：https://nodejs.org/；macOS 也可以直接使用 release/ 中打包好的 ProfitScript.app。')
  process.exit(1)
}

/** 优先用 node 直接执行 npm-cli.js（避免 Windows 上 .cmd 需要 shell 的告警），找不到时退回 shell */
function resolveNpm() {
  const candidates = []
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath)
  candidates.push(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return { command: process.execPath, prefix: [candidate], shell: false }
  }
  return { command: isWindows ? 'npm.cmd' : 'npm', prefix: [], shell: isWindows }
}

function runSync(npmArgs, label) {
  const npm = resolveNpm()
  console.log(`\n$ npm ${npmArgs.join(' ')}`)
  const result = spawnSync(npm.command, [...npm.prefix, ...npmArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: npm.shell,
  })
  if (result.status !== 0) {
    console.error(`\n${label} 失败（退出码 ${result.status ?? '未知'}）。`)
    process.exit(result.status ?? 1)
  }
}

const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
if (!fs.existsSync(tsxCli)) {
  console.log('检测到依赖未安装，首次运行先执行 npm install（可能需要几分钟）…')
  runSync(['install'], '安装依赖')
}

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.log('未找到前端构建产物 dist/，先执行 npm run build …')
  runSync(['run', 'build'], '构建前端')
}

async function probe(timeoutMs = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url}/api/health`, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json()
    return data?.ok ? data : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function appInfo() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(`${url}/api/app-info`, { signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function openBrowser(target) {
  try {
    if (process.platform === 'darwin') spawn('open', [target], { detached: true, stdio: 'ignore' }).unref()
    else if (isWindows) spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* 打不开浏览器时手动访问即可 */
  }
}

async function printReady() {
  const info = await appInfo()
  console.log('')
  console.log('============================================================')
  console.log(`  毛利·粗算面板已启动：${url}`)
  if (info?.version) console.log(`  版本：v${info.version}${info.packaged ? '（打包版）' : ''}`)
  if (info?.dataDir) console.log(`  数据目录（参数+缓存）：${info.dataDir}`)
  if (info?.excelDir) console.log(`  源文件目录（放入 Excel）：${info.excelDir}`)
  console.log('  首次启动会解析订单源（大文件约 2 分钟），之后走缓存约几秒钟。')
  console.log('  停止：在此窗口按 Ctrl+C；也可以直接关闭窗口。')
  console.log('============================================================')
  console.log('')
}

const existing = await probe()
if (existing) {
  console.log(`检测到 ${url} 上已有实例在运行（版本 ${existing.version ?? '未知'}），不再重复启动。`)
  await printReady()
  if (!noOpen) openBrowser(url)
  process.exit(0)
}

console.log('正在启动毛利·粗算面板…')
const child = spawn(process.execPath, [tsxCli, 'server/index.ts', ...args], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
})

let ready = false
let exited = false
child.on('exit', (code, signal) => {
  exited = true
  if (!ready) {
    console.error(`\n服务进程启动失败（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）。`)
    console.error(`如果提示端口被占用，请换一个端口重试：--port ${port + 1}`)
    process.exit(1)
  }
  process.exit(code ?? 0)
})

for (let attempt = 0; attempt < 300 && !exited; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400))
  const health = await probe()
  if (!health) continue
  ready = true
  await printReady()
  if (!noOpen) openBrowser(url)
  break
}

if (!ready && !exited) {
  console.error(`\n等待 ${url} 启动超时。若端口被占用，请用 --port 指定其他端口。`)
  child.kill()
  process.exit(1)
}

const shutdown = () => {
  if (!child.killed) child.kill('SIGINT')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
