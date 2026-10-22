# 打包与运行（macOS / Windows）

应用版本号统一维护在 [shared/version.ts](../shared/version.ts)（`APP_VERSION`），并与 `package.json` 的 `version` 保持一致；页头、`/api/health`、`/api/app-info`、打包文件名和 macOS `Info.plist` 均使用该版本号。

当前版本：**v1.2.0**

## 产物

执行打包（默认同时构建 macOS arm64、macOS x64、Windows x64）：

```bash
npm run package:app           # 全部平台
npm run package:app:mac       # 只构建 macOS（Apple Silicon + Intel）
npm run package:app:win       # 只构建 Windows
```

产物在 `release/`：

| 文件 | 说明 |
| --- | --- |
| `profit-script-v1.2.0-macos-arm64.zip` | macOS Apple Silicon（M1/M2/M3…） |
| `profit-script-v1.2.0-macos-x64.zip` | macOS Intel |
| `profit-script-v1.2.0-win-x64.zip` | Windows x64 |
| `manifest.json` | 版本、构建时间、各 zip 的 SHA-256 |

每个 macOS 包内包含：

```
ProfitScript.app/                 ← 双击运行（内部启动本地服务并自动打开浏览器）
profit-script.command             ← 命令行启动（./profit-script.command）
node                              ← 官方 Node.js 运行时（未修改，保留官方签名）
app.cjs                           ← esbuild 打包后的服务端（含全部依赖）
dist/                             ← 构建后的前端静态文件
README-运行说明.txt
```

Windows 包内为 `profit-script.cmd`、`node.exe`、`app.cjs`、`dist/`、`README-运行说明.txt`。

安装包 **不包含** `excel/` 源文件和 `data/` 缓存（源文件可自行放置、数据目录独立保留），因此 zip 只有约 30–45 MB（主要是 Node 运行时）。

## macOS 首次运行

从网络下载的 zip 会被 macOS 打上 quarantine 标记，首次运行前执行一次：

```bash
xattr -dr com.apple.quarantine ProfitScript.app
```

然后双击 `ProfitScript.app`（若仍提示「无法验证开发者」：右键 → 打开 → 仍要打开，或到「系统设置 → 隐私与安全性」点击仍要打开）。也可在终端运行：

```bash
chmod +x node profit-script.command
./profit-script.command
```

> 说明：安装包内是官方 Node.js 运行时 + 打包后的应用代码，未做 Apple 开发者签名/公证。若你的 Mac 策略禁止运行未签名应用，需要 IT 用公司证书对 `ProfitScript.app` 进行签名/公证后再分发。

## 数据目录与版本升级（保留缓存与参数）

打包版默认把可变数据写入系统应用数据目录，**不在程序目录内**：

| 平台 | 默认数据目录 |
| --- | --- |
| macOS | `~/Library/Application Support/ProfitScript/` |
| Windows | `%APPDATA%\ProfitScript\` |
| 开发模式 | 项目根目录 |

目录结构：

```
<数据目录>/excel/       ← 源文件（用户放置，不随包分发）
    订单源/ 成本表/ 月消耗表/ 商务订单/
<数据目录>/data/
    config.json         ← 人工参数、缺失成本补录、状态归类、字段顺序
    cache/              ← 解析缓存（*.json.gz，可删，删后下次启动重建）
```

首次启动会自动创建上述目录并写入 `excel/源文件放入说明.txt`。升级时：

1. 解压新版本，替换程序文件/`ProfitScript.app`；
2. 不要删除 `<数据目录>`，原有参数与缓存继续生效。

可用以下方式覆盖目录（优先级：命令行 > 环境变量 > 默认）：

```bash
# 命令行
./profit-script.command --home /Users/you/ProfitScript --excel /Users/you/ProfitScript/excel --port 8787
# 环境变量
PROFIT_SCRIPT_HOME=/Users/you/ProfitScript ./profit-script.command
```

其他参数：`--port <端口>`（默认 8787）、`--data <配置目录>`、`--dist <前端目录>`、`--no-open`（不自动打开浏览器）、`--help`。

页头会显示版本号（`v1.2.0`）与数据目录 tooltip；面板 Ⅲ「数据文件」卡片底部显示源文件目录 / 数据目录，并提供「打开」按钮（服务端调用系统文件管理器）。

## 打包实现

1. `vite build` 生成 `dist/`；
2. esbuild 把 `server/index.ts` 及其依赖打成一个 CJS 文件 `build/app.cjs`（`unzipper` 的可选 S3 依赖被标记为 external，本地文件解析不受影响）；
3. 按目标平台下载 [nodejs.org](https://nodejs.org/dist/) 官方 Node.js v22.14.0 运行时（缓存在 `build/cache/`）；
4. 组装程序目录，macOS 额外生成 `Info.plist` 与 `.app` 结构；
5. 用 archiver 打包 zip，并为 `node`、启动脚本显式写入 `0755` 权限（zip 的 Unix 外部属性）；打包脚本会解析 zip 中央目录自检可执行位，失败即中止；
6. 生成 `release/manifest.json`（版本/SHA-256）。

构建脚本还接受 `--skip-web`（复用已有 `dist/`）、`--targets macos-arm64`（只构建指定目标）。

构建完成后可运行 `node scripts/verify-release.mjs` 校验安装包结构（manifest/版本/Mach-O/Info.plist/zip 可执行位）。

## 本地验证记录（Windows 主机）

- Windows 打包版可启动：`/api/health` 返回 `version=1.2.0, packaged=true`，页面正常渲染，`/api/export.xlsx` 与 `/api/costs/template.xlsx` 均返回 200（esbuild 单文件打包后 Excel 读写仍然正常）；
- 缓存与参数保留：将现有 `data/config.json`（含 121 条补录成本、0.24 元/件包装费等真实参数）与 `data/cache/`（27 个缓存文件）复制到打包版数据目录后启动，订单数 636,752、`cached=true`（约 3.4s），参数全部生效；修改参数后重启应用，参数仍在（写入 `<数据目录>/data/config.json`）；
- 版本与目录展示：页头显示 `v1.2.0`，面板 Ⅲ「数据文件」显示「打包版 v1.2.0」、源文件目录与数据/缓存目录及「打开」按钮，浏览器控制台无错误（截图 `docs/screenshots/11-packaged-header.png`、`12-packaged-datadir.png`）；
- 配置写盘保护：每次保存前把上一份配置备份为 `data/config.json.bak`，并采用「临时文件 + 原子重命名」写入；
- E2E 测试会先备份本机已保存参数，测试结束后通过 API 恢复（同时校验恢复结果），避免回归测试覆盖真实配置；
- macOS 包在 Windows 主机上完成组装与结构校验：Mach-O 64 头（arm64 / x86_64）、`node` 与启动脚本在 zip 中为 `0755`、`Info.plist` 的 `CFBundleShortVersionString=1.2.0`、启动脚本为 LF 换行的 bash；但**未在真实 macOS 上执行**；首次运行请按上文解除 quarantine，如遇系统策略限制需签名/放行。
