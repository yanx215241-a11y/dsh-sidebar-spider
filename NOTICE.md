# NOTICE · 代码来源与署名

本仓库包含两部分代码，均以 MIT 许可发布：

## 1. 原始可视化代码（原作者）

- 项目：[Kirito14IT/prompt-spider-ui](https://github.com/Kirito14IT/prompt-spider-ui)
- 许可：MIT，Copyright (c) 2026 Kirito14IT
- 本仓库以最小子集方式 vendored 在 `vendor/canvas-engine/`，固定 commit
  `f6522df29739ccc4861c1227601980b88265923d`（v1.2.0，2026-10-23）：
  - `app/spider.js`（蜘蛛身体/腿/须/心跳）
  - `app/probes.js`（触手/探针姿态）
  - `app/live-layout.js`（轨道布局与 alpha）
  - `app/orbit.js`（星轨视图）
  - `app/motion.js`（`cubicPoint()` 飞行几何）
- 这些模块的绘制实现按原样使用（构建脚本对每个模块做 SHA-256 校验），
  其版权归原作者所有；完整 MIT 文本见 `vendor/canvas-engine/LICENSE` 与
  `plugin/lib/THIRD_PARTY_LICENSES.txt`。

## 2. 后续开发与修改（本仓库维护者）

- 许可：MIT，Copyright (c) 2026 yanx215241-a11y
- 覆盖：DSH 客户端插件骨架（sidebar 注册、会话事件折叠）、紧凑蛛网与大屏组合层、
  数据模型与交互、自动上滑 / 逐词触手框 / 流式标签 / 累计计数等后续优化与新增代码，
  以及对原始模块的移植适配（ESM 拆分、命名空间封装、参数化改造等）。

## 生成产物

`embed/spider-widget.js`、`scene/scene.js`、`plugin/lib/client.js` 由上述两部分
拼装生成，版权归各自作者共同所有，均以 MIT 许可发布。

MIT 全文见仓库根目录 [`LICENSE`](LICENSE)。
