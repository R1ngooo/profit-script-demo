import path from 'node:path'
import { buildApp } from './app'
import { APP_VERSION, APP_DISPLAY_NAME } from '../shared/version'
import {
  ensureHomeLayout,
  openExternal,
  parseCliArgs,
  printHelp,
  resolveRuntimePaths,
} from './runtime'

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2))
  const defaultPort = Number(process.env.PORT ?? 8787)
  if (cli.help) {
    printHelp(defaultPort)
    return
  }

  const packaged =
    cli.packaged || process.env.PROFIT_SCRIPT_PACKAGED === '1' || Boolean((process as { pkg?: unknown }).pkg)
  // 打包运行时 app.cjs 与 dist/ node 在同一目录；开发模式使用项目目录
  const appDir = packaged ? path.dirname(process.execPath) : process.cwd()
  const paths = resolveRuntimePaths({
    argv: { ...cli, packaged },
    env: process.env,
    cwd: process.cwd(),
    appDir,
  })
  ensureHomeLayout(paths, { seedExcel: paths.packaged })

  const port = Number.isFinite(cli.port) && cli.port ? cli.port : defaultPort
  const app = await buildApp({ ...paths, version: APP_VERSION, packaged })
  await app.listen({ host: '127.0.0.1', port })

  const url = `http://127.0.0.1:${port}`
  console.log(`[profit-script] ${APP_DISPLAY_NAME} v${APP_VERSION} 已启动：${url}`)
  console.log(`[profit-script] 数据目录（配置+缓存）：${paths.dataDir}`)
  console.log(`[profit-script] 源文件目录（Excel 放在这里）：${paths.excelDir}`)
  if (cli.openBrowser ?? packaged) openExternal(url)
}

main().catch((error) => {
  console.error(`[profit-script] 启动失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
