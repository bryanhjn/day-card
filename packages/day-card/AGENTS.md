# AGENTS.md

本包是 magpie 社区页面插件「每日用量卡（Day card）」：把一天 / 一周 / 一月 / 全部的 AI 用量画成一张小票，可复制为图片或保存为 PNG。源码在社区仓库 `magpie-community/plugins` 的 `packages/day-card/`。**用户可见行为以 `README.md` 为准，改行为时同步更新**；项目理解、踩过的坑与调参经验见 `memory.md`。

## 每次改完必须维护 memory.md

`memory.md` 是给后来者（以及下一个 agent）的长期记忆，不是一次性文档。

- 改动**行为、约定或渲染管线**时，在 `memory.md` 对应小节更新；发现新的坑、新的本机限制、新的调参结论，**追加**到相应小节（或新建小节）。
- 只写"为什么"和"怎么验证"，不复制代码，不重复 README 的用户说明。
- 改了 `LOOK` 里的观感数值并定稿时，把结论（哪一档偏重、哪一档看不清）记进 `memory.md` 的热敏效果小节，免得下次从头试。
- 若某条经验被推翻（例如某个绕行不再需要），**改正原条目**而不是再追加一条矛盾的。

## 命令

本包没有构建步骤：`page/*.js` 就是线上运行的代码，改完即生效。

```sh
bun test                        # 本包内：day-card.test.mjs（仓库根目录跑则跑全仓）
bun test day-card.test.mjs -t "关键字"   # 按用例名过滤
```

- 单测喂真实形状的 `usage:day` 数据给 `view.js` / `backgrounds.js`，并**断言 `app.js` 的源码字符串**——改这些字符串会连带改测试。
- 端到端（可选，需要 playwright）：
  ```sh
  NODE_PATH=<playwright 的 node_modules> node day-menu.gui.mjs
  NODE_PATH=<playwright 的 node_modules> node bg-delete.gui.mjs
  ```
  两者都用桩 bridge 驱动真实页面，跑 Chromium + WebKit。

## 发布

- **合并 PR 即发包**：`packages/day-card/package.json` 的 `version` 变化触发 `.github/workflows/publish.yml`。**版本号必须和改动在同一个 PR**，只改代码不改版本不会发版。
- `registry.json` 里这一条（`kind: "page"`、`community: true`）只在名称、图标或中英文简介变化时才需要改。

## 架构要点

- **没有宿主进程、没有服务、没有网络请求**；只有 `usage:day` 一个读权限。页面 CSP 不允许 fetch，所以字体（`fonts.js`）、图标（`icons.js`）、照片（`bg/*.js`）都是内联的 data:/base64，照片按需用 `<script>` 注入。
- `page/app.js` 负责绘制与交互；`page/view.js`（`DayView`）是唯一的取数与文案层；`page/backgrounds.js`（`DayBackgrounds`）负责背景与选项归一化。
- 版面以点为单位的固定纸宽（`PW = 440`），纸高由 `slip()` 测量；画布按 `scale = max(2, min(3, ceil(dpr)))` 放大。**画图用点，用设备像素时必须显式乘 `scale`。**
- 墨层画在**独立 canvas** 上再做印刷磨损，最后按纸的 `Path2D` 裁切贴到纸上。磨损不能直接作用在纸面，否则会啃掉纸纹和折痕。
- `做旧`（`aged`，默认开）同时控制折痕与热敏印刷磨损；`Logo`（`logo`，默认开）是独立开关，控制纸上的 Agent 标志水印（`watermark()`，画在纸纹之下）。

## 验证实施效果的方法

改动渲染相关代码后，按下面的顺序验证。**全部步骤都不需要 playwright**，本机即可完成。

### 1. 语法检查

`page/app.js` 是普通脚本（`defer`），`view.js` / `backgrounds.js` / `icons.js` 是经典脚本。本机 `bun` 可能不在 PATH，用 node 兜底：

```powershell
node --input-type=module -e "import {readFileSync} from 'node:fs'; new Function(readFileSync('page/app.js','utf8')); console.log('parses')"
```

### 2. 跑单测

```sh
bun test
```

**本机没有 bun 时的替代方案**（只作兜底，提交前有条件仍应跑真 bun）：

1. 建一个 `node_modules/bun/test.mjs` 垫片，导出 `test(name, fn)`（收集结果、捕获异常）与 `expect(v)`，实现用到的匹配器（`toBe` / `toEqual` / `toMatchObject` / `toContain` / `toMatch` / `not`）。
2. 把 `day-card.test.mjs` 复制到临时目录，删掉 `import ... from "bun:test"` 行，把 `const dir = import.meta.dir` 换成目标目录常量，再 import 执行。
3. 打印收集到的结果，全绿即通过。

### 3. 在真实浏览器里看效果（核心步骤）

页面必须先加载 `_magpie/bridge.js`，且在 `magpie.ready` 之后才绘制，所以**不能用 `file://` 直接打开**（会是空白纸或完全不画）。

1. 把 `page/` 复制到临时目录，新建 `page/_magpie/bridge.js` 作为桩：
   ```js
   window.magpie = {
     ready: Promise.resolve({ lang: "zh", dark: false }),
     onTheme() {},
     read: async () => ({ /* 一份形状正确的 usage:day */ }),
     options: { get: async () => null, set: async () => {} },
     image: { copy: async () => {}, save: async () => ({}) },
   };
   ```
   要测某个选项，就让 `options.get` 返回它（例如 `{ aged: false }`）。想看另一种语言，改 `lang`。
2. 起一个本地静态服务（node 一行 http server 即可，**不要用 `python -m http.server`**，本机可能没有）。
3. 用 Edge headless 截图（本机有 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）：
   ```powershell
   & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --hide-scrollbars `
     --force-device-scale-factor=2 --window-size=760,1500 --virtual-time-budget=9000 `
     --screenshot="shot.png" "http://127.0.0.1:PORT/index.html"
   ```
   - `--virtual-time-budget` 要给够（≥ 8000ms），否则字体和 `draw()` 还没完成。
   - `--force-device-scale-factor=2/3` 用来检查高倍屏下的纹理与像素效果。
   - 截图会有若干 stderr 噪音（如 QQBrowser 导入路径），忽略即可。

### 4. 放大检查细节

整图看不清颗粒和断笔，用 `System.Drawing` 裁切放大（`NearestNeighbor` 才能看清像素）：

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("shot.png")
$rect = New-Object System.Drawing.Rectangle $x, $y, $w, $h
$bmp = New-Object System.Drawing.Bitmap (($w*3), ($h*3))
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0,0,($w*3),($h*3)), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save("crop.png", [System.Drawing.Imaging.ImageFormat]::Png)
```

注意 PowerShell 的 `New-Object X (args)` 里不要写 `$a * $b` 表达式（会被当成数组展开而报错），先把尺寸算进变量。

### 5. 抓页面运行时错误

`draw()` 是 async，异常会落进 `unhandledrejection`，截图只表现为"纸是空的"。注入错误收集再 dump DOM：

```powershell
# 把 index.html 的 app.js 标签前插入：
#   <script>window.__errs=[];addEventListener("error",e=>__errs.push("ERR:"+e.message+" @"+e.lineno));
#   addEventListener("unhandledrejection",e=>__errs.push("REJ:"+(e.reason&&e.reason.stack||e.reason)));</script>
# 末尾加一个 <pre id="dbg"> 和 setTimeout 写入 __errs
& "...\msedge.exe" --headless=new --disable-gpu --virtual-time-budget=9000 --dump-dom "http://127.0.0.1:PORT/debug.html" | Select-String 'id="dbg"' -Context 0,6
```

`Script error.` 这种无信息的报错通常是**跨域脚本**或文件编码坏了（见下面第 7 条），把脚本改到同源 HTTP 下加载即可看到真实行号。

### 6. 验证开关真的生效（而不是"看起来像"）

对"开启 / 关闭某效果"这类改动，不要只靠肉眼看两张图。用页面自身的 canvas 取像素对比：

```js
// 在页面里执行
const ink = () => {
  const d = document.getElementById("card").getContext("2d")
    .getImageData(0, 0, card.width, card.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i+1] < 120 && d[i+2] < 120) dark++;
  return dark;
};
// 关 → 等一次重绘 → 取值；开 → 等一次重绘 → 取值
```

`做旧` 开启时应比关闭**深色像素更少**（磨损把墨啃掉了一点，但字仍清晰）。数量级：2× 下约少 4–5%。差异为 0 说明开关没接上，差异过大说明磨损太重。

`Logo` 水印是浅灰（`LOOK.watermark.alpha = 0.13`），**不会**进入"深色像素"阈值：开与关的深色像素差只有十几个。要验它，把阈值放宽到 210 左右，或直接比截图。水印开启时，`< 210` 的像素应明显更多。

### 7. 性能检查

拖动滑杆会连续重绘，所以带像素运算的效果必须确认不是每帧都重算缓存：

```js
const t0 = performance.now();
for (let i = 0; i < 3; i++) { /* 触发两次重绘，中间 await 一次 */ }
console.log(performance.now() - t0);
```

参考值：1184×1746 下 `press()` 全流程约 100–150ms/次。超过 300ms 要回头看 `inkGrain()` / `base()` 的缓存是否命中。

### 8. 收尾

- 视觉定稿后，把观感结论写进 `memory.md`。
- 若改了行为，同步 `README.md`。
- 若加了文案，`view.js` 的五种语言必须补齐（单测会守卫）。
- 若改了 `package.json` 的 `version` 才发布；只改代码不改版本不会发版。

## 编码与文件操作的坑（务必遵守）

- **不要用 PowerShell 的 `Set-Content` 写仓库里的源码文件**：默认按本地代码页编码，中文和 emoji 会被写成 `?` 或乱码，`app.js` 会直接 `SyntaxError`。用编辑工具写，或至少 `-Encoding utf8`。
- 复制文件用 `Copy-Item`，不要"读出来再写回去"。
- `package.json` 的 `magpie.page.titles` 在本 checkout 里已是乱码（历史问题），**不要重写该文件**。
- 临时产物（截图、桩 bridge、临时页面）放 `C:\Users\<user>\AppData\Local\Temp\kilo\` 下，不要留在工作区；`.trae-html-share-packages/`、`.screenshots/` 是本地生成物，不入库。
