# @magpie-community/page-day-card

A page in [magpie](https://usemagpie.ai)'s window that prints a day of your AI usage (or a week, a month or all of it) as a receipt, a "Daily AI statement" on paper over a backdrop of your choice. It has the day's API-equivalent cost, your streak, requests, errors and the day against your average day before it, then each agent and its models with their logos and costs, and the day's tokens: input, output and the cache hit rate. Its foot credits [nowdex](https://nowdex.app), whose share card the receipt's design follows. **Background** picks what the paper lies on: nothing (the paper alone, a transparent PNG), teal, fifteen patterns (gingham, graph paper, kraft, cyanotype, seigaiha waves, xuan paper and more), four landscape photos, or a picture of your own (pick one, drop it on the page or paste it; the × at its corner removes it). A slider sets the margin around the paper; a photo also has blur and dim. **Aged**, left of the backdrop picker, turns the slip's folds and creases off for a flat sheet, and with them the thermal head's wear: on, the print comes off an uneven head — its feed's lines, columns that run cool, patches the coating takes less heat in, and the title and the total, printed heaviest, mottled and broken where it starved — all of it taking ink off the type alone, never the paper. Off, the slip is flat and printed clean. **Logos**, its own switch beside it and on by default, scatters the agents' official marks — Codex, DeepSeek Harness, Claude Code, Kilo Code, Grok Build and VS Code — in pale grey over the slip's head, as a watermark in the paper under its grain and under the print, each turned a little and set about the height of the total's digits; DeepSeek's mark is the one that does not scatter, set larger in the paper's left margin beside the total. The choices are kept in the plugin's options. **Copy image** puts the card on the clipboard; **Save PNG** saves it in Downloads.

Install it from magpie's **Plugins › Discover**, or with `magpie plugin add @magpie-community/page-day-card`. It then has a tab, **Day card** (titled in the window's language: 每日用量卡, 1日の使用量カード, Tageskarte), under Plugins in the sidebar, in the app and in `magpie web`. The switch at the left picks **Day**, **Week** (the seven days ending on the date shown), **Month** (the thirty) or **All** (every day with calls, up to today); a week's or a month's card has its period, the days that had calls and the cost of one such day in place of the streak against an average day. Beside it, **Agent** / **Model** picks how the card groups the cost: by agent with its models beneath (the default), or by model alone, one row a model, its cost the sum of every agent's. Pick an earlier day, or the date a week or month ends on, with the arrows (which step a whole week or month) or the date's menu. The card is shown as large as fits under the toolbar, so a whole day is on one screen; the picture you copy or save is full size.

It needs a magpie with the `usage:day` read and `magpie.image` (see `engines.magpie`). An older magpie refuses the read, and the page says to update; one from before the week, month and all-time spans (a `from` in `usage:day`) shows days only, and says to update when you pick another.

## What it reads

Only `usage:day`, the one permission its `package.json` declares (`magpie.permissions`): a day's (or a span's) totals, each agent's and model's, the days before it that had calls, and the agents' and providers' logos. Nothing in it is a key, an account, a session or a prompt.

Like every plugin page, it runs in a sandboxed frame with no network (`connect-src 'none'`) and no inline scripts. The card is drawn on a canvas, the same in a light or dark theme, and its PNG goes to magpie through `_magpie/bridge.js`. In `magpie web` the browser copies or downloads it itself.

## Files

- `page/index.html`, `page/style.css`: the page.
- `page/view.js`: what the card says, in English, 简体中文, 繁體中文, 日本語 and Deutsch, with no DOM. The test loads it.
- `page/app.js`: reads through the bridge, draws the card, copies and saves it, and refreshes today's every minute.
- `page/backgrounds.js`: the backdrops, drawn on the canvas, and what a saved choice may be.
- `page/bg/`: the four photos and their thumbnails, as JPEG data in scripts the page loads when it needs them. A picture the frame loads from a URL would taint the canvas, and the card could no longer be copied or saved.
- `page/fonts.js`: the receipt's face, a subset of [JetBrains Mono](https://www.jetbrains.com/lp/mono/) 2.304 as woff2 data (`page/fonts.LICENSE.txt`, SIL OFL 1.1). The frame can't fetch a font file, so the page loads these bytes with `FontFace`.

## Test

```sh
bun test packages/day-card
```

中文：在 magpie 窗口里加一个「每日用量卡」页面，把某一天（或最近 7 天、30 天、全部）的用量打印成一张小票（Daily AI Statement）：当天按 API 价计的费用、连续使用天数、请求数、错误数、与此前日均的倍数，每个 Agent 及其模型（带图标和费用），以及输入、输出 token 和缓存命中率。小票底部注明设计灵感来自 [nowdex](https://nowdex.app)。「背景」可以换成 15 种图案、4 张风景照片或自己的图片（选择、拖入或粘贴，角上的 × 可删除），边距可调，照片还可调模糊和压暗。左上角的开关切换「日 / 周 / 月 / 全部」。「做旧」开关折痕与热敏印刷的磨损；它右边的「Logo」（默认勾选）把小票上半部分铺上一层浅灰的 Agent 标志水印——Codex、DeepSeek Harness、Claude Code、Kilo Code、Grok Build、VS Code 的官方图标，散落、略微倾斜，压在纸纹之下、正文之上；DeepSeek 的那个不参与散落，放大固定在总费用左侧的页边。可以「复制图片」到剪贴板，或「保存 PNG」到下载文件夹。只读取声明过的 `usage:day`，运行在无网络的沙盒 frame 里。
