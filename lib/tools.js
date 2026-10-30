/**
 * Model-facing tools: quiet_on / quiet_off / quiet_status (v2).
 *
 * Definitions are plain registry objects (the same shape `defineTool` returns)
 * so the plugin carries no runtime imports beyond Node built-ins and its own
 * modules. That keeps a `file:///.../lib/index.js` headless load working without
 * a profile install.
 */
import { isSubagentSession } from './state.js';

const TEXT_OUTPUT = Object.freeze({
  schema: { type: 'string' },
  render: (_args, value) => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) },
  ],
});

function defineTool(name, description, execute) {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      return execute(args, exec);
    },
  };
}

function requireAgent(exec, toolName) {
  const agent = exec?.agent;
  if (agent === undefined) {
    throw new Error(`${toolName}: 需要主会话上下文（exec.agent 缺失）`);
  }
  return agent;
}

function sessionIdOf(agent) {
  const id = agent?.session?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('quiet-subagents: 当前 agent 缺少 session.id');
  }
  return id;
}

/**
 * @param {import('./state.js').QuietStore} store
 * @param {{ logFile?: string, settledDelivery?: string, humanize?: boolean, language?: string }} config
 * @param {(event: string, detail?: object) => void} log
 */
export function createToolDefinitions(store, config, log) {
  return [
    defineTool(
      'quiet_on',
      '为当前主会话开启一次性「安静子代理」模式（B 方案：会话级、手动武装、单次失效）。' +
        '武装后启动的直接子代理，其 agent-message 与 subagent-settled 会被合并成一条自然语言气泡，' +
        '放进 next-turn 排队区，不会 steer 进正在运行的主轮；本次子代理交互交付完毕后自动解除。' +
        '只能由主会话调用；重复调用不会重置已有气泡。' +
        '重要：quiet 是异步交付，只保证结果不打断当前主轮，不保证消息形态。' +
        '主轮完成自己的事就直接结束本轮；不要用 quiet_status/list_agents/pwsh 轮询、sleep 或读子会话日志等待普通 subagent。' +
        'wait_agent 只等待 Agent Teams 成员，不能等待普通 subagent。' +
        '如果本轮必须拿到子代理结果，请不要使用 quiet_on。',
      async (_args, exec) => {
        const agent = requireAgent(exec, 'quiet_on');
        if (isSubagentSession(agent)) {
          throw new Error(
            'quiet_on: 只允许主会话调用；子代理会话的安静模式由直接父会话的武装决定',
          );
        }
        const sessionId = sessionIdOf(agent);
        const currentTurn = store.lastStepOf(sessionId)?.turn ?? 0;
        const { state, created } = store.arm(sessionId, currentTurn);
        const snapshot = store.snapshotOf(state);
        const summary =
          `quiet_on: ${created ? '已武装（armed）' : '当前会话已在安静模式中（幂等）'}。` +
          `session=${sessionId} turn=${currentTurn} phase=${snapshot.phase} ` +
          `children=${snapshot.childrenCount} pending=${snapshot.pendingQueueCount}`;
        log(created ? 'tool-quiet-on' : 'tool-quiet-on-idempotent', {
          sessionId,
          turn: currentTurn,
          snapshot,
        });
        return (
          summary +
          '。本次会话中、武装之后启动的直接子代理，其消息与完成通知会合并成一条气泡，' +
          '在主轮运行期间显示在排队区，交付完这次子代理交互后自动解除。' +
          '下一步：完成本轮后结束；不要在运行中等待或轮询；下一轮会收到结果（可能是气泡，也可能是原生消息）。' +
          '可用 quiet_status 查看状态，quiet_off 提前解除。'
        );
      },
    ),

    defineTool(
      'quiet_off',
      '提前解除当前主会话的「安静子代理」模式。只停止后续 quiet 处理；已经排队的气泡不会提前交付、' +
        '也不会被移除，仍留在 next-turn 队列按正常轮次交付。子代理会话调用无效。',
      async (_args, exec) => {
        const agent = requireAgent(exec, 'quiet_off');
        const sessionId = sessionIdOf(agent);
        const before = store.snapshot(sessionId);
        if (before.phase === 'off') {
          log('tool-quiet-off-idle', { sessionId });
          return 'quiet_off: 当前会话未处于安静模式（off），无需操作。';
        }
        const snapshot = store.disarm(sessionId, 'manual');
        log('tool-quiet-off', { sessionId, before, snapshot });
        return (
          `quiet_off: 已解除（原 phase=${before.phase}）。` +
          `已有 ${before.pendingQueueCount} 条气泡保留在 next-turn 队列，会正常交付；` +
          '不会再产生新的 quiet 气泡。'
        );
      },
    ),

    defineTool(
      'quiet_status',
      '查看当前主会话「安静子代理」模式的状态：phase、武装轮次、每个子代理的气泡数量/合并/交付状态、' +
        '排队与自动解除配置。调试用；不要用它轮询等待。不暴露子代理 UUID。',
      async (_args, exec) => {
        const agent = requireAgent(exec, 'quiet_status');
        const sessionId = sessionIdOf(agent);
        const snapshot = store.snapshot(sessionId);
        const payload = {
          ...snapshot,
          ...(snapshot.phase === 'active' || snapshot.pendingQueueCount > 0
            ? {
                nextAction:
                  '不要在本轮等待或轮询；结束本轮后结果会在下一轮到达（气泡或原生消息）。需要同轮结果时请勿使用 quiet_on。',
              }
            : {}),
          config: {
            onlyCompleted: store.config.onlyCompleted,
            autoOff: store.config.autoOff,
            ttlTurns: store.config.ttlTurns,
            settledDelivery: store.config.settledDelivery,
            humanize: store.config.humanize,
            language: store.config.language,
            resolvedLanguage: store.language,
            logFile: config.logFile ?? null,
          },
        };
        log('tool-quiet-status', { sessionId, snapshot });
        return JSON.stringify(payload, null, 2);
      },
    ),
  ];
}
