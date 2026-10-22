# 启动进程

当前版本 **v1.2.0**。启动后浏览器访问 <http://127.0.0.1:8787>（默认端口）。

## 方式一：双击启动（最简单）

| 系统 | 双击文件 | 说明 |
| --- | --- | --- |
| Windows | **`启动应用.cmd`** | 自动检查 Node、装依赖、构建前端（如缺失），启动服务并打开浏览器 |
| macOS | **`启动应用.command`** | 同上；首次使用若提示没有权限，先在终端执行 `chmod +x 启动应用.command` |

启动脚本会：

1. 检查 Node.js（需要 20 或更高版本，本机实测 Node 24）；
2. 首次运行自动 `npm install`（需要联网，几分钟）；
3. 如缺 `dist/` 自动 `npm run build`；
4. 启动本地服务（`scripts/start-app.mjs` → `tsx server/index.ts`）；
5. 等待健康检查通过后自动打开浏览器，并打印数据目录与源文件目录。

> macOS 若不想装 Node，可直接使用打包好的 [release/](../release) 中 `profit-script-v1.2.0-macos-arm64.zip`（Apple Silicon）或 `-macos-x64.zip`（Intel），解压后去掉隔离并双击 `ProfitScript.app`，详见 [PACKAGING.md](PACKAGING.md)。

## 方式二：命令行

```bash
# 首次
npm install
npm run build
npm start                    # 启动，默认 http://127.0.0.1:8787

# 或用一键脚本（macOS/Linux 终端）
./启动应用.command            # 或 bash 启动应用.command；Linux 也可 ./start.sh
```

可选参数（`npm start` 或启动脚本都支持）：

```bash
npm start -- --port 8788             # 指定端口
npm start -- --home D:\ProfitScript  # 指定数据目录（config.json + cache/）
npm start -- --excel D:\Excel        # 指定 Excel 源文件目录
npm start -- --no-open               # 不自动打开浏览器

node scripts/start-app.mjs --port 8788 --no-open   # 一键脚本的等价写法
node scripts/start-app.mjs --help                   # 查看全部参数
```

也可以使用环境变量：`PORT`、`PROFIT_SCRIPT_HOME`、`PROFIT_SCRIPT_EXCEL`、`PROFIT_SCRIPT_NO_OPEN=1`。

## 数据目录与源文件

- **开发/源码方式**：默认数据目录为项目根目录下的 `data/`（`data/config.json` + `data/cache/`），Excel 源文件在项目根目录 `excel/`；
- **打包版**：默认数据目录为 macOS `~/Library/Application Support/ProfitScript/`、Windows `%APPDATA%\ProfitScript\`，其中 `excel/` 放源文件、`data/` 保存参数与缓存；
- 页头显示版本号；面板 Ⅲ「数据文件」底部显示源文件目录 / 数据目录，并可点「打开」。

## 确认是否启动成功

- 浏览器打开 <http://127.0.0.1:8787> 能看到面板；
- 或访问接口：<http://127.0.0.1:8787/api/health>，返回 `{"ok":true,"version":"1.2.0",...}`。

首次启动会流式解析订单源（抖音大文件约 2 分钟），之后使用缓存约几秒；解析进度在页面顶部显示。

## 停止进程

- 启动窗口前台运行：按 **Ctrl+C** 或直接关闭窗口；
- Windows 查端口占用并结束：

  ```bat
  netstat -ano | findstr :8787
  taskkill /PID <上面的PID> /F
  ```

- macOS / Linux：

  ```bash
  lsof -ti:8787 | xargs kill
  ```

## 后台运行（服务器/长期使用）

```bash
# macOS / Linux：日志写入 profit-script.log，关闭终端不退出
nohup ./启动应用.command --no-open > profit-script.log 2>&1 &

# macOS 打包版也可以后台运行
nohup ./profit-script.command --no-open > profit-script.log 2>&1 &
```

Windows 建议直接双击 `启动应用.cmd` 保持窗口打开；如需后台运行可用任务计划程序执行 `node scripts\start-app.mjs --no-open`。

## 常见问题

| 问题 | 处理 |
| --- | --- |
| 提示未检测到 Node.js | 安装 Node.js 20+（<https://nodejs.org/>），或改用打包版 |
| 端口被占用 / `EADDRINUSE` | 换端口：`npm start -- --port 8788`，或结束占用 8787 的进程 |
| 页面 404 / 接口正常但无界面 | 缺少前端构建产物，执行 `npm run build` 后重启 |
| 首次解析很慢 | 正常，大文件约 2 分钟；之后走缓存；可在页面右上角点「刷新数据」强制重解析 |
| 想清空缓存 | 删除数据目录下 `data/cache/` 后重启 |
| 参数想迁移/备份 | 复制数据目录下 `data/config.json`（上一份自动备份为 `config.json.bak`） |

## 已实机验证（Windows + Node 24）

- 双击 `启动应用.cmd` 可启动并自动校验健康接口（实测端口 8794 / 8796 / 8797）；
- 重复启动会检测到已有实例并直接打开浏览器，不会重复占用端口；
- 删除 `dist/` 后启动会自动执行 `npm run build` 再启动；
- 关闭窗口或 Ctrl+C 即停止，端口随之释放；
- macOS 的 `启动应用.command` / `start.sh` 已做 LF 换行与 shebang 校验（当前构建机为 Windows，未在真实 macOS 执行）。
