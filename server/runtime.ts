import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface CliOptions {
  home?: string
  excel?: string
  data?: string
  dist?: string
  port?: number
  packaged: boolean
  openBrowser: boolean | null
  help: boolean
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { packaged: false, openBrowser: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => argv[++index]
    switch (arg) {
      case '--home':
        options.home = value()
        break
      case '--excel':
        options.excel = value()
        break
      case '--data':
        options.data = value()
        break
      case '--dist':
        options.dist = value()
        break
      case '--port':
        options.port = Number(value())
        break
      case '--packaged':
        options.packaged = true
        break
      case '--open':
        options.openBrowser = true
        break
      case '--no-open':
        options.openBrowser = false
        break
      case '-h':
      case '--help':
        options.help = true
        break
      default:
        break
    }
  }
  return options
}

/** 打包运行时的默认数据目录（缓存、配置都保存在这里，升级不丢） */
export function defaultHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PROFIT_SCRIPT_HOME) return path.resolve(env.PROFIT_SCRIPT_HOME)
  const home = homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'ProfitScript')
  if (process.platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'ProfitScript')
  return path.join(home, '.local', 'share', 'profit-script')
}

export interface RuntimePaths {
  home: string
  excelDir: string
  dataDir: string
  distDir: string
  packaged: boolean
}

/**
 * 解析运行时目录：
 * - 开发模式（tsx）：默认使用项目目录；
 * - 打包模式：默认使用系统应用数据目录，保证配置与缓存升级后仍保留；
 * - 均可用 --home/--excel/--data 或 PROFIT_SCRIPT_* 环境变量覆盖。
 */
export function resolveRuntimePaths(input: {
  argv: CliOptions
  env: NodeJS.ProcessEnv
  cwd: string
  appDir: string
}): RuntimePaths {
  const { argv, env, cwd, appDir } = input
  const packaged = argv.packaged || env.PROFIT_SCRIPT_PACKAGED === '1'
  const home = path.resolve(argv.home ?? env.PROFIT_SCRIPT_HOME ?? (packaged ? defaultHomeDir(env) : cwd))
  const excelDir = path.resolve(argv.excel ?? env.PROFIT_SCRIPT_EXCEL ?? path.join(home, 'excel'))
  const dataDir = path.resolve(argv.data ?? env.PROFIT_SCRIPT_DATA ?? path.join(home, 'data'))
  const distDir = path.resolve(
    argv.dist ?? env.PROFIT_SCRIPT_DIST ?? path.join(packaged ? appDir : cwd, 'dist'),
  )
  return { home, excelDir, dataDir, distDir, packaged }
}

const EXCEL_SUBDIRS = ['订单源', '成本表', '月消耗表', '商务订单']

const README_TEXT = [
  '把 Excel 源文件放到本目录（源文件不会被打包，也不会上传）：',
  '',
  'excel/',
  '  订单源/        各平台订单表（快手/视频号/抖音/天猫/拼多多/京东/小红书 .xlsx）',
  '  成本表/        成本表（Sheet1：B 商品编码、C 商品名、含「月/成本/单价」的成本列）',
  '  月消耗表/      月消耗表（汇总页按「电商平台」汇总消耗）',
  '  商务订单/      商务订单表（目录名可改为「9月份商务订单」等，含「商务订单」即可）',
  '',
  '数据与缓存默认保存在：',
  '  <数据目录>/data/config.json  人工参数、补录成本、状态归类',
  '  <数据目录>/data/cache/       解析缓存（删除后下次启动会自动重建）',
  '',
  '升级应用时只需替换程序，保留此数据目录即可继续使用原有参数与缓存。',
  '',
  '如需指定其他目录，启动时使用参数或环境变量：',
  '  --home <数据目录>   或环境变量 PROFIT_SCRIPT_HOME',
  '  --excel <源文件目录> 或环境变量 PROFIT_SCRIPT_EXCEL',
  '  --data <配置目录>   或环境变量 PROFIT_SCRIPT_DATA',
  '  --port <端口>       或环境变量 PORT（默认 8787）',
].join('\n')

export function ensureHomeLayout(paths: RuntimePaths, options: { seedExcel?: boolean } = {}): void {
  mkdirSync(paths.dataDir, { recursive: true })
  mkdirSync(path.join(paths.dataDir, 'cache'), { recursive: true })
  if (!options.seedExcel) return
  mkdirSync(paths.excelDir, { recursive: true })
  for (const dir of EXCEL_SUBDIRS) mkdirSync(path.join(paths.excelDir, dir), { recursive: true })
  const readmePath = path.join(paths.excelDir, '源文件放入说明.txt')
  if (!existsSync(readmePath)) writeFileSync(readmePath, README_TEXT, 'utf8')
}

function launchDetached(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    /* 打开浏览器/目录失败不影响服务运行 */
  }
}

export function openExternal(target: string): void {
  if (process.platform === 'darwin') launchDetached('open', [target])
  else if (process.platform === 'win32') launchDetached('cmd', ['/c', 'start', '', target])
  else launchDetached('xdg-open', [target])
}

export function printHelp(port: number): void {
  console.log(
    [
      '毛利·粗算面板（profit-script）',
      '',
      '用法：profit-script [--port 8787] [--home <目录>] [--excel <目录>] [--data <目录>] [--no-open]',
      '',
      '默认：',
      `  端口 ${port}`,
      '  数据目录：系统应用数据目录（macOS 为 ~/Library/Application Support/ProfitScript）',
      '  源文件目录：<数据目录>/excel（可用 --excel 覆盖）',
    ].join('\n'),
  )
}
