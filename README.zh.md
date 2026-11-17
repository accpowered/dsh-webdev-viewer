# dsh-webdev-viewer

DeepSeek Harness（DSH）插件：在**右侧栏**里与 agent 一起开发和验证 Web / Electron UI。

> 状态：**调研 / 原型脚手架（v0.0.0-dev）**。仓库尚不可安装；第一个可用版本计划在路线图 Phase 2 结束（见 [`docs/wayfinder/MAP.md`](docs/wayfinder/MAP.md)）。

## 目标能力

- 右侧栏运行真实 Chromium 页面，而不是截图轮询。
- 用户和 agent 操作**同一个页面**：点击、输入、滚动、导航、检查。
- 在页面上点选元素，把结构化引用插入 DSH 输入框。
- 在选中的元素上调整常用视觉样式并实时预览；把 before/after 变更作为批注发给 agent，由 agent 写源码。
- 把工作区目录作为静态站点预览，文件变化后自动刷新。
- 运行项目 dev server（Vite、Next 等），或通过 CDP attach Electron renderer。
- 给 agent 完整页面信息：带 ref 的 DOM/ARIA snapshot、console、network、截图。
- 打开任意 HTTP(S) 网站，包括 loopback 服务。
- tab 可 floating/fullscreen，也可在 headed Chrome/Electron 窗口中镜像同一页面。

## 设计方向

首选基座是 [`@linxin666/dsh-client-ui-browser-view`](https://www.npmjs.com/package/@linxin666/dsh-client-ui-browser-view)：它已有 CDP 浏览器、screencast 面板、snapshot refs、截图、console/network。我们补上人机输入转发、元素选取、静态预览/热更新、项目运行和 Electron attach。

相关文档：

- [`docs/wayfinder/MAP.md`](docs/wayfinder/MAP.md) — 决策地图与当前 frontier。
- [`docs/research/`](docs/research/) — 带引用的调研笔记。
- [`docs/adr/`](docs/adr/) — 架构决策记录。
- [`UPSTREAM.md`](UPSTREAM.md) — 上游基座、许可证发现与归属。

## 目录

```
src/core/    CDP、tabs、actions、snapshot、screenshot、protocol
src/host/    browser service、routes、tools、preview server、runner、watcher
src/client/  右侧栏 tab、screencast、输入、picker、日志、toolbar
src/shared/  两端共享的 wire types
docs/        wayfinder 地图、调研、ADR、插件详情
locale/      en/zh UI 文案
tests/       单元、集成、组件测试
scripts/     构建与打包脚本
```

## 许可证与归属

仓库当前使用 Apache License 2.0 文本：上游包实际附带的 `LICENSE` 是 Apache-2.0，尽管其 `package.json` 和 README badge 写的是 BSD-3-Clause。该差异记录在 [`UPSTREAM.md`](UPSTREAM.md)，首次发布前必须解决。见 [`LICENSE`](LICENSE) 与 [`NOTICE`](NOTICE)。

## 贡献

v0.1 范围锁定前不接受外部贡献；决策讨论请走 wayfinder 地图。
