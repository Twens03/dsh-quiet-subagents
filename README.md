# Quiet Subagents for DeepSeek Harness

[English](README.md) · [简体中文](readme/README.zh-CN.md)

![release](https://img.shields.io/badge/release-v0.2.1-blue)
![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.2-purple)
![platform](https://img.shields.io/badge/platform-Web%20%7C%20Host-lightgrey)
![license](https://img.shields.io/badge/license-MIT-green)

> A session-scoped, manually armed, one-shot "quiet mode" for direct subagents.
> Let the main session finish its current work; handle the child result on the next turn.

`dsh-quiet-subagents` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin. It does not change the subagent itself. It changes **when messages from direct child subagents are delivered**: while quiet mode is armed, a child's `send_message` and completion notice no longer steer into the running main turn. They wait in the QueueDock above the Web composer and are delivered as one human-readable bubble on the next turn.

Use it when:

- the main session is working on a long task and a child is only gathering data or running a script;
- you do not want a child's intermediate message to steer into the current turn and interrupt the model's flow;
- the child result can be handled after the main turn ends.

[Install](#installation) · [Quick start](#quick-start) · [Configuration](#configuration) · [Limitations](#limitations) · [Troubleshooting](#troubleshooting)

## Features

- **Per session**: only the armed main session is affected.
- **Manual and one-shot**: you must arm it explicitly; it disarms itself after delivery.
- **Direct child subagents**: works with `subagent` / `subagent_fork`. Agent Teams `team-message` and ordinary user messages are untouched.
- **One bubble per child**: by default, a child's message and completion are merged into one QueueDock bubble that refreshes in place.
- **No child UUID by default**: bubble titles are human-readable. With `humanize=false`, the raw runtime text is kept and may include the child id.
- **Configurable auto-off**: disarm when the bubble is delivered, or after the main session replies.
- **Three settled-delivery modes**: merged, always separate, or no separate completion bubble when a message exists.
- **Plugins-page settings card**: configure the plugin from the bundle detail page; no YAML editing required.
- **No network requests, no telemetry**: the plugin only handles local DSH events. Optional JSONL logging is available for debugging.

## Requirements

- DeepSeek Harness Web, **DSH >= 0.2.1-rc.2**.
- Developed and GUI-tested on `0.2.1-rc.2`. The `0.2.1-rc.3` changes do not touch this plugin's integration points, but run a quick regression after upgrading.
- Pure ESM, no build step. The Node version requirement is the `engines.node` field in `package.json`.

> DSH's agent and queue surfaces are still evolving. This plugin aims to stay compatible, but re-test the quiet flow after a major DSH upgrade.

## Installation

This project is distributed through GitHub for now, **not npm**.

### Install from GitHub

The repository root is this package directory (`package.json` and `cordis.patch.yml` at the top). From the machine that runs DSH:

```bash
dsh plugin --profile desktop add github:Twens03/dsh-quiet-subagents
```

To pin a commit:

```bash
dsh plugin --profile desktop add github:Twens03/dsh-quiet-subagents#<commit-sha>
```

> This command installs the plugin into the `desktop` profile. DSH plugins are isolated per profile; to use it in the Web app, run:
>
> ```bash
> dsh plugin --profile web add github:Twens03/dsh-quiet-subagents
> ```

This is a **pure JavaScript** bundle: `lib/` and `client/` are committed, so there is no `prepare`/build step and no `allowBuilds` authorization is needed. DSH reads `dsh.bundle` and adds the package to the profile's bundle list; if your DSH version does not do that automatically, add `"dsh-quiet-subagents"` to `dsh.profile.bundles` and restart.

### From a GitHub release ZIP

1. Download the [latest release](https://github.com/Twens03/dsh-quiet-subagents/releases) and extract it.
2. In DSH Web, open **Plugins**.
3. Use **Add plugin** to install the extracted `dsh-quiet-subagents` directory (or install the package from this repository if your DSH version supports repository installation).
4. Enable the plugin and restart DSH.
5. Open the plugin details and confirm that the **Quiet subagents** settings card appears.

The plugin does not auto-update. To update, replace the installed directory with a newer release and restart DSH.

### Developer install from a checkout

```bash
git clone https://github.com/Twens03/dsh-quiet-subagents.git
dsh plugin --profile desktop add /path/to/dsh-quiet-subagents
```

DSH should add the package to `dsh.profile.bundles` because it declares `dsh.bundle`; if it does not, add:

```json
"dsh-quiet-subagents"
```

Restart DSH. This path is for development; regular users can use the GitHub command or a release ZIP.

> If the settings card is missing: confirm the plugin is installed and enabled, restart DSH, and make sure you installed a real package directory rather than a read-only development link. Some local link installations cannot expose the client config schema; install a packaged/physical copy instead.

## Quick start

In the **main session**:

1. Arm quiet mode:

   ```text
   quiet_on
   ```

2. Start a direct child subagent. Let it do its work and call `send_message` when it has something to report.
3. **Continue your own main-turn work.** Do not poll, sleep, or read child logs just to wait for the child.
4. Finish the main turn when your work is done.
5. On the next turn, the result arrives as a QueueDock bubble or as a normal delivered message.
6. Quiet mode disarms itself after that child interaction is delivered.

To stop early:

```text
quiet_off
```

To inspect the current state without exposing child UUIDs:

```text
quiet_status
```

### Important: quiet delivery is asynchronous

The purpose of quiet mode is **not** to make the main turn wait synchronously for a child. It prevents the child from interrupting the running turn.

- Main turn still has work: keep working; do not poll.
- Main turn is done: end it; handle the result next turn.
- You need the child result in the same turn: do **not** use quiet mode. Let the native message steer in, or use Agent Teams with `spawn_teammate` + `wait_agent`.
- `quiet_off` does not speed up queued bubbles. It stops further quiet processing; already queued bubbles still deliver normally.

## Configuration

Open **Plugins → dsh-quiet-subagents** and use the settings card. Settings are saved to the profile and take effect after DSH restarts.

| Setting | Default | Values | Meaning |
|---|---|---|---|
| `enabled` | `true` | `true` / `false` | `false` disables all hooks and tools |
| `onlyCompleted` | `true` | `true` / `false` | Let failed or aborted settlements pass through |
| `autoOff` | `delivered` | `delivered` / `replied` | When quiet mode disarms |
| `ttlTurns` | `3` | positive integer | Fallback turns when no child message arrives after arming |
| `settledDelivery` | `coalesce` | `coalesce` / `always` / `never` | How completion notices are delivered |
| `humanize` | `true` | `true` / `false` | Keep raw runtime text when `false`; useful for debugging |
| `language` | `auto` | `auto` / `zh` / `en` | Bubble copy language |
| `debug` | `false` | `true` / `false` | Mirror plugin events to the DSH log |
| `logFile` | unset | file path | Optional: write event-by-event JSONL evidence |

### `autoOff`

| Value | Behavior |
|---|---|
| `delivered` | Disarm as soon as the last bubble is claimed on a later turn |
| `replied` | Deliver the bubble, then wait for the main session's `turn-stopping` before disarming |

Both modes auto-disarm; only the timing differs.

### `settledDelivery`

| Value | Behavior |
|---|---|
| `coalesce` | Default. One bubble per child; settled refreshes it in place to "Subagent finished" |
| `always` | Always create a separate "Subagent finished" bubble; a child may produce two bubbles |
| `never` | When a `send_message` exists, do not create a separate completion bubble; append new closing text to the same bubble and keep the "Subagent message" title. If only settled arrives, still create a finished bubble |

`never` edge case: if the original bubble has already been claimed by the next turn and the closing has new content, the plugin adds a short finished bubble so information is not lost. If there is no new content, it adds nothing.

## Delivery behavior

- A child message first enters DSH's `next-step` queue. At the next `agent/pre-step`, the plugin turns it into a `next-turn` QueueDock bubble.
- The bubble therefore does not appear at the exact millisecond of `send_message`; it waits for the main turn's next step boundary.
- If `send_message` and settled are already waiting at the same pre-step, the first visible state is already the finished state. This is intentional merging.
- QueueDock claims one `next-turn` item per turn. Multiple children arrive across multiple turns; QueueDock shows a collapsed count.
- After a bubble is claimed, it becomes part of the main session context. If the main turn ends at that exact step, the QueueDock bubble may never be painted because the claim happens before the browser renders. The result is still delivered on the next turn.

## Limitations

- **Asynchronous, not synchronous**: quiet mode does not make the main turn wait. It only keeps child messages from steering into the running turn.
- **State is in memory**: restarting DSH clears quiet state. Arm it again when needed.
- **Direct child subagents only**: user messages and Agent Teams `team-message` do not go through quiet mode.
- **The first bubble may not be visible**: if the main turn ends too quickly, the `next-turn` item can be claimed before the browser paints it. The result is not lost, but QueueDock may show no bubble.
- **Multiple children arrive over multiple turns**: `next-turn` claims one item per turn. This is DSH queue behavior, not message loss.
- **Depends on DSH integration surfaces**: the plugin uses DSH's agent/queue extension points. Re-test after major DSH upgrades.
- **Web settings card needs the client half**: the Host tools can work in supported non-Web environments, but the graphical settings card only appears in a Web UI that supports `plugins.bundle.config`.

## Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| `quiet_on` is rejected as child-only | A subagent session cannot arm quiet mode; call it in the main session that starts the child |
| No bubble appears after arming | The message may have been claimed on the next turn; check whether the result arrived and use `quiet_status` for phase/delivered |
| Bubbles arrive across several turns | Multiple children or queued next-turn items; DSH claims one per turn |
| `quiet_off` does not show a result immediately | It does not flush queued bubbles; they still deliver on normal turns |
| No settings card | Confirm install, enablement, and restart; use a physical/packaged install rather than a read-only development link |
| `never` mode has no separate completion bubble | Expected: completion text is merged when a message exists; inspect the closing text |
| Quiet mode does not auto-off | Check `onlyCompleted`, `ttlTurns`, and `quiet_status`; use `quiet_off` if needed |

## Privacy

- No network requests and no telemetry.
- Child results are delivered only through the local DSH session queue.
- `debug` and the optional `logFile` record events. If enabled, make sure the logs do not contain sensitive content.

## Development

The package has two halves:

- `lib/`: Host plugin; registers tools, listens to DSH events, and maintains quiet state.
- `client/`: Web client half; registers the `plugins.bundle.config` settings card on the Plugins page.

There is no build step. Restart DSH after changing Host code, or use DSH's client development flow for client changes.

See [CHANGELOG.md](CHANGELOG.md) for release notes and [LICENSE](LICENSE) for the license.

## License

MIT
