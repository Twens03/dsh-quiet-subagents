# Quiet Subagents for DeepSeek Harness

[English](../README.md) · [简体中文](README.zh-CN.md)

> 会话级、手动开启、一次性的「安静子代理」模式。
> 让主会话在子代理返回时继续完成当前任务，把子代理结果留到下一轮处理。

`dsh-quiet-subagents` 是一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。它不会改变子代理本身，只改变**直接子代理**的消息交付时机：开启 quiet 后，子代理的 `send_message` 和完成通知不再中途打断主轮，而是进入 Web 输入框上方的 QueueDock，等主会话结束当前轮后，在下一轮以一条自然语言气泡交付。

适合这样的场景：

- 主会话正在做长任务，子代理只是去查资料/跑脚本；
- 不希望子代理的中间消息 steer 进当前轮、打断模型思路；
- 主轮结束后再集中处理子代理结果。

## 特性

- **按会话生效**：只对当前主会话开启，不影响其他会话。
- **手动、一次性**：需要显式开启；交付完自动解除，下次使用要再次开启。
- **直接子代理**：支持普通 `subagent` / `subagent_fork`；Agent Teams 的 `team-message`、用户消息不受影响。
- **合并展示**：默认每个 child 一条 QueueDock 气泡；完成时原地刷新为「子代理工作完成」。
- **默认不显示 child UUID**：气泡标题干净，完整结果仍在模型上下文中；`humanize=false` 时保留 runtime 原始文本，可能包含 child id。
- **自动解除可配置**：气泡交付后解除，或等主会话回复后再解除。
- **三种完成通知策略**：合并、始终独立、仅在无消息时通知。
- **Plugins 页图形设置**：安装后在插件详情页直接调开关和下拉项，不需要手改 YAML。
- **无网络请求、无遥测**：插件只处理本机 DSH 内部事件；可选 JSONL 日志用于排障。

## 要求

- DeepSeek Harness Web，**DSH >= 0.2.1-rc.2**。
- 在 `0.2.1-rc.2` 上完成开发和 GUI 验证；`0.2.1-rc.3` 的变更未触及本插件依赖，但仍建议升级后做一次最小回归。
- 纯 ESM，无构建步骤；Node 版本要求以 `package.json` 的 `engines.node` 为准。

> DSH 的 agent/queue 接口仍在演进。插件会尽量保持兼容，但 DSH 大版本升级后建议先跑一次 quiet 场景再长期使用。

## 安装

本项目目前通过 GitHub 分发，**暂未发布到 npm**。

### 从 GitHub 安装

仓库根目录就是本插件目录（`package.json`、`cordis.patch.yml` 在根层）。在运行 DSH 的机器上执行：

```bash
dsh plugin --profile desktop add github:Twens03/dsh-quiet-subagents
```

需要锁定 commit 时：

```bash
dsh plugin --profile desktop add github:Twens03/dsh-quiet-subagents#<commit-sha>
```

> 复制此命令将插件安装到desktop profile，dsh的插件按profile隔开，如果要在网页端中使用，应输入 `dsh plugin --profile web add github:Twens03/dsh-quiet-subagents`

这是**纯 JavaScript** 组合包：`lib/` 和 `client/` 已提交，不需要 `prepare`/构建，也不需要 `allowBuilds` 授权。DSH 会根据 `dsh.bundle` 把包加入 profile 的 bundle 列表；如果你的 DSH 版本没有自动加入，手动把 `"dsh-quiet-subagents"` 写进 `dsh.profile.bundles` 后重启。

### 从 GitHub Release 安装

1. 下载[最新 Release](https://github.com/Twens03/dsh-quiet-subagents/releases) 的 ZIP 并解压。
2. 在 DSH Web 打开 **Plugins**。
3. 使用 **Add plugin** 选择解压后的 `dsh-quiet-subagents` 目录（如果你的 DSH 版本支持从仓库安装，也可以直接选择本仓库）。
4. 启用插件并重启 DSH。
5. 打开插件详情，确认出现「安静子代理」设置卡片。

插件不会自动更新。升级时用新 Release 替换已安装目录并重启 DSH。

### 开发者：从本地源码安装

```bash
git clone https://github.com/Twens03/dsh-quiet-subagents.git
dsh plugin --profile desktop add /path/to/dsh-quiet-subagents
```

DSH 会根据 `dsh.bundle` 自动把包加入 `dsh.profile.bundles`；如果没有自动加入，手动添加：

```json
"dsh-quiet-subagents"
```

重启 DSH。此方式用于开发调试；普通用户可以使用 GitHub 命令或 Release ZIP。

> 如果设置卡片没有出现：确认插件已安装并启用、DSH 已重启，且安装的是实际文件目录而不是只读的符号链接。部分本地链接安装方式下，客户端设置 schema 可能无法解析；改用打包后的目录/发行包即可。

## 快速开始

在主会话中：

1. 开启 quiet：

   ```text
   quiet_on
   ```

2. 启动一个直接子代理，让它执行任务并 `send_message` 回来。
3. **继续做你主轮里的事情**。不要为了等子代理而轮询、sleep 或读取子会话日志。
4. 主轮工作完成后直接结束本轮。
5. 下一轮开始时会收到结果：QueueDock 气泡，或原生交付消息。
6. 本次子代理交互交付完毕后，quiet 自动关闭。

需要提前停止时：

```text
quiet_off
```

查看当前状态（不暴露 child UUID）：

```text
quiet_status
```

### 重要：quiet 是异步交付

quiet 的目的不是让主轮“同步等待子代理”，而是**不打断当前主轮**。

- 主轮还有工作：继续做，不要轮询；
- 主轮完成：结束本轮，下一轮处理结果；
- 本轮必须拿到子代理结果：不要使用 quiet，改用原生消息 steer，或 Agent Teams 的 `spawn_teammate` + `wait_agent`；
- `quiet_off` 不会加速已排队气泡的交付，它只停止后续 quiet 处理。

## 配置

安装后可在 **Plugins 页 → dsh-quiet-subagents 详情**中调整。配置保存到 profile，重启 DSH 后生效。

| 配置 | 默认值 | 可选值 | 说明 |
|---|---|---|---|
| `enabled` | `true` | `true` / `false` | `false` 时完全不注册 hook 和工具 |
| `onlyCompleted` | `true` | `true` / `false` | 失败/中止的 settlement 是否直接放行 |
| `autoOff` | `delivered` | `delivered` / `replied` | 自动解除时机 |
| `ttlTurns` | `3` | 正整数 | 开启后一直没有子代理消息时的兜底轮数 |
| `settledDelivery` | `coalesce` | `coalesce` / `always` / `never` | 完成通知策略 |
| `humanize` | `true` | `true` / `false` | `false` 时保留 runtime 原始文本，便于排障 |
| `language` | `auto` | `auto` / `zh` / `en` | 气泡文案语言 |
| `debug` | `false` | `true` / `false` | 将插件事件写入 DSH 日志 |
| `logFile` | 未设置 | 文件路径 | 可选：逐事件写入本地 JSONL 证据日志 |

### `autoOff`

| 值 | 行为 |
|---|---|
| `delivered` | 最后一条气泡在后续轮次被 claim 时立即解除 |
| `replied` | 气泡交付后，等到主会话该轮 `turn-stopping`（已回复）再解除 |

两者都会自动解除；区别只是解除时机。

### `settledDelivery`

| 值 | 行为 |
|---|---|
| `coalesce` | 默认；每个 child 一条气泡，settled 原地刷新为「子代理工作完成」 |
| `always` | settled 始终产生独立的「子代理工作完成」气泡；一个 child 可能产生两条 |
| `never` | 有 `send_message` 时不产生独立完成气泡；closing 新内容追加到同一条，标题保持「子代理消息」；只有 settled 时仍生成「子代理工作完成」 |

`never` 的边界：如果原气泡已经被下一轮 claim，而 closing 又有新内容，无法再原地追加，插件会补一条短完成气泡，避免信息丢失；没有新内容则不补。

## 交付行为

- 子代理消息先进入 DSH 的 `next-step`；插件在下一个 `agent/pre-step` 把它转成 `next-turn` 的 QueueDock 气泡。
- 因此气泡不会在 `send_message` 的毫秒级立即出现，而是等到主轮的下一个 step 边界。
- 如果 `send_message` 和 settled 都已到达同一 pre-step，第一眼看到的就是完成态；这是正常的合并行为。
- QueueDock 每轮只 claim 一条 `next-turn` 项。多个 child 的气泡会分多轮到达，QueueDock 会显示折叠计数。
- 气泡被 claim 后即进入主会话上下文；如果主轮刚好在这一步结束，气泡可能因为渲染窗口太短而**没有可见的 QueueDock 动画**，但结果仍会在下一轮正常交付。

## 已知限制

- **异步而非同步**：quiet 不会让主轮原地等待子代理；它只保证消息不在主轮中途 steer 进来。
- **状态在内存**：DSH 进程重启后 quiet 状态丢失；重新使用需要再次开启。
- **只处理直接子代理**：普通用户消息、Agent Teams 的 `team-message` 不走 quiet。
- **可能看不到第一帧气泡**：主轮结束太快时，`next-turn` 项可能在浏览器绘制前就被 claim；消息不会丢，但 QueueDock 气泡不可见。
- **多 child 分轮到达**：`next-turn` 每轮只 claim 一条，这是 DSH 队列语义，不是插件丢消息。
- **依赖 DSH 内部集成面**：插件使用 DSH 的 agent/queue 扩展点；DSH 大版本升级后建议回归测试。
- **Web UI 设置卡片需要 client half**：Host 工具可以在无界面环境使用，但图形设置卡片只在支持 `plugins.bundle.config` 的 Web UI 中出现。

## 排障

| 现象 | 可能原因 / 处理 |
|---|---|
| `quiet_on` 报错，提示只允许主会话 | 子代理会话不能武装；请在启动子代理的主会话调用 |
| 开启后没有看到气泡 | 消息可能已被下一轮 claim；看下一轮是否收到结果，并用 `quiet_status` 确认 phase/delivered |
| 气泡分好几轮才到 | 多个 child / 多条 next-turn 项，按 DSH 每轮一条的规则交付 |
| `quiet_off` 后没有立即出现结果 | 它不会 flush 已排队气泡；气泡仍会在正常轮次交付 |
| 插件页没有设置卡片 | 确认已安装、启用、重启；本地链接安装建议改用实际目录/发行包 |
| `never` 模式没有独立完成气泡 | 预期行为：有消息时完成信息合并到同一条；查看正文 closing |
| 没有自动解除 | 检查 `onlyCompleted`、`ttlTurns` 和 `quiet_status`；必要时 `quiet_off` |

## 隐私

- 插件不发起网络请求，不收集遥测。
- 子代理结果只通过 DSH 本地会话队列交付。
- `debug` 和可选的 `logFile` 会记录事件；如果开启，请自行确认日志中不含敏感内容。

## 开发

插件由两部分组成：

- `lib/`：Host 插件，注册工具、监听 DSH 事件、维护 quiet 状态；
- `client/`：Web client half，在 Plugins 页注册 `plugins.bundle.config` 设置卡片。

没有构建步骤。修改后重启 DSH，或按 DSH 的 client 开发流程加载。

## License

MIT
