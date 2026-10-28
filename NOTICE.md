# NOTICE · 第三方代码与署名

本仓库包含来自以下上游项目的代码（MIT 许可）：

## prompt-spider-ui

- 项目：<https://github.com/Kirito14IT/prompt-spider-ui>
- 许可：MIT（Copyright (c) 2026 Kirito14IT），完整文本见 `vendor/prompt-spider-ui/LICENSE` 与 `plugin/lib/THIRD_PARTY_LICENSES.txt`
- 固定版本：`f6522df29739ccc4861c1227601980b88265923d`（v1.2.0，2026-10-23），机器可读信息见 `vendor/prompt-spider-ui/UPSTREAM.json`
- 本仓库 vendored 的最小子集（`vendor/prompt-spider-ui/app/`）：
  `spider.js`（蜘蛛身体/腿/须/心跳）、`probes.js`（探针姿态）、`live-layout.js`（轨道布局与 alpha）、
  `orbit.js`（星轨视图）、`motion.js`（cubicPoint 飞行动画）。
- 生成产物：`embed/spider-widget.js`、`scene/scene.js` 由 `embed/build/build-widget.mjs`、
  `scene/build/build-scene.mjs` 将上述上游模块（未修改的绘制实现）与仓库内的组合层
  （`embed/src/widget.js`、`scene/src/scene-dashboard.js`）拼接而成；组合层、DSH 插件骨架、
  事件折叠、大屏版式适配为本项目新增代码。

## 其他

- 本项目的 DSH 插件形态（`window.__ModuleLoader__.load` 惰性 CJS bundle、`dsh.client` 清单、
  右侧栏 `sidebarRightTabs` / `slots` 扩展点）依据 DeepSeek Harness 桌面版自带的插件文档与构建产物实现，
  不包含 DSH 自身源码。
