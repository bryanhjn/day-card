# memory.md — day-card 项目理解与经验

本文件记录**为什么这么做**、踩过的坑和验证手段。用户可见行为以 `README.md` 为准；改行为时两处同步。新学到的东西请追加进来（见 `AGENTS.md`）。

## 这个包是什么

magpie 窗口里的一个**页面插件**（`magpie.page`），把一天 / 一周 / 一月 / 全部 AI 用量画成一张"小票"图片，可复制或存 PNG。纯前端：没有宿主进程、没有服务、没有网络请求，只有一个 `usage:day` 读权限。

- `package.json` → `magpie.page.file` 指向 `page/index.html`；`files` 只打包 `page/`、`README.md`、`NOTICE`。
- 没有构建步骤。`page/` 里的 `.js` 就是线上运行的代码，改完即生效。

## 文件分工

| 文件 | 作用 |
| --- | --- |
| `page/index.html` | 骨架：工具栏（区间 / 分组 / 日期 / 做旧 / Logo / 背景 / 复制 / 保存）+ `<canvas id="card">` |
| `page/app.js` | 全部绘制与交互。约 1300 行，是一个 `(async () => { ... })()` 自执行异步函数：先 `await magpie.ready`，所以它在 `<script defer>` 里运行，不暴露任何全局 |
| `page/view.js` | 纯计算 + 全部文案（`DayView`）：`card()` 把 `usage:day` 的读数变成绘制用的数据结构；`count/money/hitRate/menuDays/spanFrom/stepDate/...` |
| `page/backgrounds.js` | 背景（`DayBackgrounds`）：图案、照片、自定义图；`norm()` 归一化已保存选项，`paint()` 绘制 |
| `page/icons.js` / `fonts.js` | 内联的图标与字体字节（data: / base64），因为页面 CSP 不允许 fetch |
| `page/bg/*.js` | 照片，按需 `<script>` 注入（`photoSrc`） |
| `day-card.test.mjs` | `bun test` 单测：喂真实形状的 `usage:day` 数据给 `view.js` / `backgrounds.js`，并**断言 `app.js` 源码里的关键字符串** |
| `day-menu.gui.mjs` / `bg-delete.gui.mjs` | Playwright 端到端（Chromium + WebKit），用桩 bridge 驱动真实页面 |

## 数据链路

```
magpie.read("usage:day", {date, tz, from?})
  → state.day
  → V.card(day, lang, {span, by})   // 文案、货币、四舍五入、单位（万/亿）、按成本排序
  → slip(ctx, card, icons, scale)   // 逐行排版，返回 { h, heavy }
  → draw()                          // 背景 → 纸 → 纹理 → 折痕 → 墨层 → 撕边裁切
```

要点：

- `V.card()` 是**唯一**的取数逻辑。想改小票内容先改 `view.js`，`app.js` 只负责画。
- `usage:day` 的 `days` **只到所读日期为止**（`usageapi.SpanOf`）。日期菜单因此要额外读一次"今天"的 days（`V.menuDays(days, today, latest)`），否则选过去的周/月时，今天会跑到列表最上面。
- 货币换算在 `V.money(usd, currency, rate)`；`rate` 来自读数，不是写死的。

## 渲染管线与坐标系

- 版面以**点（point）**为单位：`PW = 440` 是纸宽，`PAD = 30` 是纸内边距；`ph` 由 `slip()` 测量得出，**不是常量**。
- 实际画布 `W×H` 乘以 `scale = max(2, min(3, ceil(dpr)))`，并 `ctx.setTransform(scale,...)`。所以：
  - `app.js` 里画图用点；**需要设备像素时必须显式 `* scale`**（`press()`、`grain()`、`drawIcon()` 都是这么做的）。
  - 纹理是位图，`pattern.setTransform(new DOMMatrix([1/scale,...]))` 把"一个贴图像素"换回"一个点"，否则高分屏上纹理变细。
- 绘制顺序（`draw()`）：
  1. `B.paint()` 背景
  2. 纸 + 阴影（`Path2D paper`，底部锯齿撕边 `TOOTH=4` / `TOOTH_PITCH=10`）
  3. **Logo 水印**（`watermark()`，仅 `bg.logo`）——画在纸纹**之前**，所以纸纹和折痕压在它上面，看起来是"纸里的水印"而不是贴上去的贴纸
  4. 纸纹（`grain(scale)`，固定种子，按 scale 缓存）
  5. 折痕（`creases()`，仅 `bg.aged`）
  6. **墨层**（独立 canvas）+ 印刷磨损（`press()`，仅 `bg.aged`）
  7. 用纸的 `Path2D` 裁切墨层，贴到纸上
- 墨层独立成 canvas 的原因：磨损用 `destination-out`/像素运算，如果直接画在纸面上会把纸纹和折痕一起啃掉。**这条是设计约束，不要合并回去。**

### LOOK 调参表

所有观感数值集中在 `app.js` 顶部的 `LOOK`，改观感只动这里：

- `paper` 纸的投影；`ink` 标题/总额的极淡投影（`glow()`）；`rule` 虚线；`grain` 纸纹；`crease` 折痕
- `press` 热敏头的缺陷（见下）

## 折痕（`creases()`）

两层：**三条大折**（折成三折 + 一道横折，固定位置，`band()` 画成"亮边 + 暗边"的软带）和**十四条随机小折**（固定种子，位置 / 角度 / 长度都随机）。

调参结论（2026-11 定稿）：

- 强度全在 `LOOK.crease`：`light` 0.09 / `dark` 0.062。旧值 0.055 / 0.04 显得偏淡。
- **亮边要明显强于暗边**：纸张在折处反光，暗边过重才会"脏"。所以暗边的 `shadowColor` 乘 0.8、描边乘 0.55，线宽也只给亮边的 0.8 倍。
- 小折数量 9 → 14（+55%，对应"增加 50%"的需求）。数量变多时如果不压暗边，整张纸会先变成灰蒙蒙的脏纸，而不是折痕更多。
- 量化验证：纸面（排除文字）亮度标准差 `sd`，关闭做旧 2.854 → 旧版开启 3.467 → 新版开启 4.40。数字变大 = 起伏更强；同时 `mean` 只从 242.2 降到 241.5，说明没有整体变暗（变暗就是脏）。
- 视觉上 3× 截图放大后，折痕仍是一条清晰的"亮线 + 细暗线"，没有糊成一片。

## 热敏印刷效果（`press()`）

真实热敏小票的"不良"来源，都已实现：

| 现象 | 实现 | 参数 |
| --- | --- | --- |
| 走纸横纹 | 全宽 0.5pt 淡线，每 3.2pt 一条 | `bands` / `bandGap` / `bandThick` |
| 冷/热元素（纵向条带） | 整条纵向渐变，边缘软 | `columns` |
| 涂层吸热不均 | 大块软斑 | `patches` |
| 走纸打滑 | 局部横线，两端渐隐 | `stalls` |
| 边缘毛刺/颗粒 | 逐像素噪声（细 + 块 + 沿行走纸方向拉长） | `grain` |
| 重墨处"缺墨" | 噪声阈值以上、且不透明处，把 alpha 打到 12% | `pinhole` / `hold` |
| 标题与总额的斑驳 | 软斑 + 短横向断笔 + 一条卡住的横线 + 一条冷列 | `mottle` / `breaks` / `starve` |

关键实现细节：

- 磨损分两层：**缓存层** `base(w,h,scale)`（走纸横纹、冷列、涂层斑、打滑；固定种子，按尺寸缓存）+ **每次重绘的层**（标题/总额的斑驳，依赖 `heavy` 框）。
- `inkGrain(px,py,scale)` 按像素尺寸缓存 `Float32Array`，否则拖动滑杆时每帧重算噪声会卡。**噪声必须按尺寸缓存**。
- `slip()` 通过 `heavyAt()` 记录标题和总额的包围盒（`{x,y,w,h}`，点为单位），`press()` 用 `scale` 换成像素。
- `between([lo,hi])` 只接受**数组**。传数字会抛 `number 0.32 is not iterable`——我踩过一次，页面直接白屏（只有纸，没有字），且因为 `draw()` 是 async，报错落在 unhandledrejection 里。
- 全部随机数固定种子：同一尺寸下每次重绘是同一张小票。

## `做旧`（aged）与 `Logo`（logo）两个开关

`backgrounds.norm()` 里 `aged` 与 `logo` **默认都是 true**，只有显式 `false` 才关。

`aged` 同时控制：

1. 折痕（`creases()`）
2. 热敏印刷磨损（`press()`）

即 `if (bg.aged) press(...)`。关掉 = 平整纸 + 干净打印（"头工作正常"）。这是产品语义，不是实现细节；加新的"做旧"类效果时应当一起挂在这个开关下，除非有理由单独开关。

`logo` 是**独立**开关（2026-11 加）：控制纸上的 Agent 标志水印。之所以独立，是因为它是"装饰"而不是"做旧"——用户可能想要干净的纸但保留水印，或反过来。

- 六个标志：Codex / DeepSeek Harness / Claude Code / Kilo Code / Grok Build / VS Code，全部是 magpie 自己的官方图标（`packages/agent-office/page/icons/*.svg`；VS Code 的取自 magpie 可执行文件内嵌的 `assets/icons/vscode.svg`），以 base64 内联在 `icons.js` 的 `logo-*` 键下，并标 `mono: true`，这样 `drawIcon()` 的 `tint` 参数会把它们整体染成浅灰，而不是保留品牌色。
- Codex 的官方 SVG 带一块白色圆角底板；作为水印那块底板会印成一个灰方块，所以 `logo-codex` 去掉了那条白色 path，只留标志本体。
- **DeepSeek 的标志是"定海神针"（`LOOK.watermark.hero`）**：不参与随机散布，固定钉在 `(68, 212)` pt、边长 58pt，也就是总费用左侧的页边、与总费用数字同高。这个位置和尺寸是按用户给的红框（截图里 97×95 px @ scale 1.645）换算到小票坐标定的。
- **钉住一个标志时，绝不能让其余标志挪位**（踩过，用户退回）：散落位置来自同一个带种子的随机序列，每个标志按顺序取数。第一版实现做了两件"看起来很自然"的事，结果把整个序列往后推了，五个标志全跑位：
  1. 用 `MARKS.filter(n => n !== hero.name)` 把 DeepSeek 从循环里剔除 → 少跑一轮，后面的取数全部错位；
  2. 把 hero 的占位 `push` 进 `placed` 数组 → 后面每个标志的避让判定都变了。
  正确做法：**六个标志照旧全部走循环**，只在"画不画"上分叉——hero 那一轮照常取随机数（连 `turn` 也要取，否则后面的 `rnd()` 又错位），然后 `return` 不画；与 hero 位置冲突的标志**丢弃而不是重新寻位**（重新寻位会消耗额外随机数）。占位检查用独立的 `onHero()`，不要塞进 `clear()`。
  验证手段：写一个纯 node 脚本，用同一 seed 跑两遍（有/无 hero），逐项比对五个非 hero 标志的 `x, y, s, turn` 是否完全相同。改这块时一定要跑一次。实测加 hero 前后：`codex (99.88, 288.20) / claude (220.32, 113.69) / kilo (229.66, 254.12) / grok (88.68, 393.95) / vscode (308.38, 366.35)` 全部一致。
- 位置：`watermark()` 用**拒绝采样**（不是网格）：每个标志随机落点，要求与已放置的保持 `gap` 间距，最多试 60 次，放不下就少放一个——所以是"随意分散"而不是排排坐。同时避开 `measured.heavy`（标题与总费用的墨迹框，留 14pt 余量），否则水印会压在数字上显得脏。
- 尺寸：散布的标志为 `totalPx * 0.72`（约总费用数字的字高）；hero 固定 58pt。
- 层次：画在纸纹**之下**（见上"绘制顺序"），所以有纸的颗粒感，且 `press()` 的磨损不会啃掉它。
- 缓存：`watermark(foot, size, scale, icons, avoid)` 按 `foot x size x scale x 标志数 x 重墨框` 缓存成一张 canvas，重绘只花一次 `drawImage`。**重墨框必须进 key**，否则换一天、总费用变宽后会复用按旧框算出的位置。
- 像素验证：开启时深色像素 52176，关闭 52165——差 11 个（水印是浅灰，几乎不落在"深色"阈值内）。**不能用深色像素数判断水印开关**，要看截图或改阈值。

## 约定与坑

- **经典脚本**：`view.js` / `backgrounds.js` / `icons.js` 通过 `new Function("globalThis", src)(scope)` 在测试里加载，所以它们**不能**在顶层依赖 DOM（`norm()` 尤其要能无 DOM 运行）。
- **i18n**：文案全在 `view.js` 的 `TEXT`，键集合必须在 en / zh / zh-TW / ja / de 里完全一致，`day-card.test.mjs` 有守卫。新增文案要一次补齐。
- **`meta().photo` 必须是布尔**：`classList.toggle(name, undefined)` 会**翻转**而不是移除。`backgrounds.js` 用 `.map(b => ({...b, photo: b.photo === true}))` 兜住；`app.js` 里断言用 `=== true`。`#957` 就是这个问题。
- **保存节流**：magpie 的 `options.set` 约 1 秒最多一次。`keep()` 用 1100ms 防抖，遇 429 再重试；滑杆拖动不能直接写。
- **`app.js` 的源码会被测试断言**：改字符串（例如 `pick({ image: "" })`、`pop.classList.toggle("photo", ...)`、`V.menuDays(`）会连带改测试。
- **`package.json` 的 `magpie.page.titles` 在本 checkout 里是乱码**（`姣忔棩鐢ㄩ噺鍗?`），是历史编码问题，与运行无关。**不要用 PowerShell 的 `Set-Content` 重写这个文件**，会把 UTF-8 再毁一次。
- 撕边是纸的一部分（`paper` 路径），墨层也要按它裁切，否则字会画到锯齿外。

## 本机环境经验（重要）

1. **`bun` 不在 PATH**（本机只有 node）。仓库的测试是 `bun test`（`import { test, expect } from "bun:test"`）。
   - 语法检查：`node --input-type=module -e "new Function(readFileSync(p,'utf8'))"`。
   - 跑单测：做一个 `node_modules/bun/test.mjs` 垫片（导出 `test`/`expect`，实现 `toBe/toEqual/toMatchObject/toContain/toMatch/not`），把测试文件里的 `import ... from "bun:test"` 去掉、`import.meta.dir` 换成常量，再用 node 跑。这样 23 条用例能全绿，但**不能替代真 bun**，提交前有条件应跑 `bun test`。
2. **PowerShell 会毁 UTF-8**：`Set-Content` 默认按本地代码页写，中文/emoji 会变 `?` 或乱码。复制文件用 `Copy-Item`，写文件用编辑工具，或用 `-Encoding utf8`。
3. **页面用 `file://` 打开画不出字**：`index.html` 先加载 `_magpie/bridge.js`（宿主注入），且页面在 `magpie.ready` 之后才画。用桩 bridge + 本地 HTTP 服务最稳。
4. **本机没有 playwright**，`*.gui.mjs` 跑不了；用 Edge headless 截图代替（见 `AGENTS.md`）。

## 已知遗留

- `package.json` 的 `titles` 乱码（见上）。
- 截图里的"开具时间"来自 `new Date()`，每次不同，比对图片时要忽略。
- `press()` 的像素运算在 1184×1746 下约 100–150ms/次；再加重活要重新计时。
