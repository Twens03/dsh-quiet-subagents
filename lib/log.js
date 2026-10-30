/**
 * Event log for dsh-quiet-subagents.
 *
 * Every decision is appended as one JSON line to `config.logFile` when set, and
 * mirrored to `ctx.logger.info` when `config.debug` is on. The standalone file
 * exists so headless tests can cite plugin-side decisions next to the session
 * log's `agent/inbox/spliced` events.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ logger?: { info?: Function, warn?: Function } }} ctx
 * @param {{ logFile?: string, debug?: boolean }} config
 */
export function createLogger(ctx, config) {
  const file = config.logFile;
  let dirReady = false;

  return function log(event, detail = {}) {
    const record = { ts: new Date().toISOString(), event, pid: process.pid, ...detail };
    if (file !== undefined) {
      try {
        if (!dirReady) {
          fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
          dirReady = true;
        }
        fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
      } catch (error) {
        try {
          ctx?.logger?.warn?.(
            `[quiet-subagents] log write failed: ${String(error?.message ?? error)}`,
          );
        } catch {
          /* logging must never change behavior */
        }
      }
    }
    if (config.debug) {
      try {
        ctx?.logger?.info?.(`[quiet-subagents] ${event} ${JSON.stringify(detail)}`);
      } catch {
        /* logging must never change behavior */
      }
    }
    return record;
  };
}
