/**
 * dsh-quiet-subagents v2 — Host plugin.
 *
 * A main session calls `quiet_on()`. Direct-subagent `agent-message` /
 * `subagent-settled` messages claimed inside a running main turn are replaced
 * by one human-readable bubble per child and immediately re-queued to
 * `next-turn` with `agent.followup`. Later messages merge into the same item;
 * settlement refreshes it in place with `agent.inbox.replace`. The runtime
 * delivers one `next-turn` item per turn; after the armed interaction is
 * delivered the mode turns itself off (single use).
 *
 * Extension points (verified against DSH 0.2.1-rc.2):
 *   - agent/pre-step (waterfall): payload { agent, messages, turn, step, signal }
 *     Step 1 claims `next-turn`; later steps claim steering input.
 *   - agent/turn-stopping (serial): turn boundary for no-child / ttl auto-off.
 *   - subagent/start (emit, scoped to the direct parent agent): track children.
 *   - agent/inbox/discarded, agent/disposed: cleanup and user-delete handling.
 */
import { QuietStore, normalizeConfig } from './state.js';
import { createLogger } from './log.js';
import { createToolDefinitions } from './tools.js';

export const name = 'quiet-subagents';

/** Tools are the only hard service dependency; agents is looked up lazily. */
export const inject = ['tools'];

/**
 * Editable live configuration for the Plugins page.
 *
 * The schema import is optional so the same file still loads from a bare
 * `file:///.../lib/index.js` in the isolated headless profile, where
 * `@deepseek-ai/schemastery` is not on the plugin's resolution path. In the
 * profile install the package is hoisted beside the plugin, so the Config
 * export exists and the Plugins page can render the option card.
 * Only volatile fields are projected by the Host settings form.
 */
let Config;
try {
  const schemaModule = await import('@deepseek-ai/schemastery');
  const z = schemaModule.default ?? schemaModule;
  Config = z.object({
    enabled: z.boolean().default(true).volatile(),
    onlyCompleted: z.boolean().default(true).volatile(),
    autoOff: z.union(['delivered', 'replied']).default('delivered').volatile(),
    ttlTurns: z.number().step(1).min(1).default(3).volatile(),
    settledDelivery: z
      .union(['coalesce', 'always', 'never'])
      .default('coalesce')
      .volatile(),
    humanize: z.boolean().default(true).volatile(),
    language: z.union(['auto', 'zh', 'en']).default('auto').volatile(),
    debug: z.boolean().default(false).volatile(),
    logFile: z.string().volatile(),
  });
} catch {
  Config = undefined;
}
export { Config };

/**
 * Resolve which armed main agents a scoped `subagent/start` carrier belongs to.
 *
 * The subagent lifecycle emitter dispatches with `scopeTarget(service, parent)`,
 * so the Cordis dispatcher binds `this` to an opaque carrier. The carrier's
 * context filter is the only public-ish way to test the scope key without
 * importing @deepseek-ai/dsh-scope (which a standalone file:// plugin cannot
 * resolve). We test it against each armed agent's own context; failure just
 * falls back to the timestamped unmatched-start list.
 *
 * @param {unknown} carrier
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {QuietStore} store
 * @returns {string[]} armed session ids this carrier belongs to
 */
export function matchArmedParents(carrier, ctx, store) {
  const matched = [];
  if (carrier === null || typeof carrier !== 'object') return matched;
  let agents = [];
  try {
    agents = ctx.get?.('agents')?.list?.() ?? [];
  } catch {
    return matched;
  }
  if (!Array.isArray(agents) || agents.length === 0) return matched;
  let symbols = [];
  try {
    symbols = Object.getOwnPropertySymbols(carrier);
  } catch {
    return matched;
  }
  for (const symbol of symbols) {
    let filter;
    try {
      filter = carrier[symbol];
    } catch {
      continue;
    }
    if (typeof filter !== 'function') continue;
    for (const agent of agents) {
      const sessionId = agent?.session?.id;
      if (typeof sessionId !== 'string' || store.get(sessionId) === undefined) continue;
      try {
        if (filter.call(carrier, agent.ctx) === true && !matched.includes(sessionId)) {
          matched.push(sessionId);
        }
      } catch {
        /* not a scope carrier / not an agent context: try the next candidate */
      }
    }
  }
  return matched;
}

/**
 * Handle one `agent/inbox/discarded` edge.
 *
 * Verified 0.2.1-rc.2 payload: `{ agent: Agent, message: UserMessage }` — the
 * inbox emits through the fused agent-scoped dispatcher (`agentEvents` adds
 * `agent`), and the live Event contract declares the same shape. Still, scan
 * every armed session by message id so a carrier-less/legacy payload cannot
 * leave a queue item pinned forever.
 *
 * @param {QuietStore} store
 * @param {unknown} payload
 * @returns {string[]} session ids whose queue item was removed
 */
export function handleDiscarded(store, payload) {
  const messageId = payload?.message?.id;
  if (typeof messageId !== 'string') return [];
  // `replace` (our in-place refresh, a user edit, or a steer) also emits
  // `agent/inbox/discarded` for the old object. If the same id is still pending
  // in either list, this is not a deletion: ignore it. A real remove leaves no
  // occurrence, so the bubble is cleared and is not resurrected.
  try {
    const agent = payload?.agent;
    const pending = [
      ...(Array.isArray(agent?.inbox?.nextTurn) ? agent.inbox.nextTurn : []),
      ...(Array.isArray(agent?.inbox?.nextStep) ? agent.inbox.nextStep : []),
    ];
    if (pending.some((message) => message?.id === messageId)) return [];
  } catch {
    /* fall through to the delete path for legacy payloads */
  }
  const affected = [];
  for (const sessionId of store.armedSessionIds()) {
    if (store.discardQueueItem(sessionId, messageId)) affected.push(sessionId);
  }
  return affected;
}

/**
 * Handle one `agent/disposed` edge. Verified 0.2.1-rc.2 payload: `{ agent }`
 * dispatched through the agent's stable carrier.
 * @param {QuietStore} store
 * @param {unknown} payload
 * @returns {string | undefined} the disposed session id
 */
export function handleDisposed(store, payload) {
  const sessionId = payload?.agent?.session?.id;
  if (typeof sessionId !== 'string') return undefined;
  store.forget(sessionId);
  return sessionId;
}

/** @param {unknown} message */
function contentText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

/** @param {unknown} agent @param {string} messageId */
function findNextTurn(agent, messageId) {
  let list;
  try {
    list = agent?.inbox?.nextTurn;
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  return list.find((message) => message?.id === messageId);
}

/**
 * Apply the IO actions planned by QuietStore.plan().
 * @param {any} agent
 * @param {string} sessionId
 * @param {any[]} actions
 * @param {(event: string, detail?: object) => void} log
 * @param {QuietStore} store
 */
function applyActions(agent, sessionId, actions, log, store) {
  for (const action of actions) {
    try {
      if (action.kind === 'followup') {
        agent.followup(action.message);
        log('followup', {
          sessionId,
          messageId: action.messageId,
          childId: action.childId,
        });
        continue;
      }
      if (action.kind !== 'replace') continue;
      const current = findNextTurn(agent, action.messageId);
      if (current === undefined) {
        log('replace-missing', {
          sessionId,
          messageId: action.messageId,
          childId: action.childId,
        });
        continue;
      }
      const currentText = contentText(current);
      if (
        typeof action.previousText === 'string' &&
        currentText !== action.previousText
      ) {
        // The user edited the queued bubble. Keep their text and append only the
        // new closing/result fragment; never overwrite the edit.
        store.markUserEdited(sessionId, action.childId);
        if (typeof action.appendText === 'string' && action.appendText.trim().length > 0) {
          const edited = {
            ...current,
            content: [
              ...(Array.isArray(current.content) ? current.content : []),
              { type: 'text', text: `\n\n${action.appendText}` },
            ],
          };
          agent.inbox.replace(action.messageId, edited);
          log('replace-user-edited', {
            sessionId,
            messageId: action.messageId,
            childId: action.childId,
          });
        } else {
          log('replace-user-edited-skip', {
            sessionId,
            messageId: action.messageId,
            childId: action.childId,
          });
        }
        continue;
      }
      agent.inbox.replace(action.messageId, action.message);
      log('replace', {
        sessionId,
        messageId: action.messageId,
        childId: action.childId,
      });
    } catch (error) {
      log('action-error', {
        sessionId,
        kind: action?.kind,
        messageId: action?.messageId,
        childId: action?.childId,
        message: String(error?.message ?? error),
      });
    }
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  if (!config.enabled) {
    ctx?.logger?.info?.('[quiet-subagents] disabled by config; no tools or hooks registered');
    return;
  }

  const log = createLogger(ctx, config);
  const store = new QuietStore(config, { onEvent: (event, detail) => log(event, detail) });

  // The Plugins page owns the option card; do not auto-generate a second
  // settings page for the same schema.
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['settings'], (child) => {
        child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
      });
    } catch {
      /* headless / older hosts may not expose the settings service */
    }
  }

  for (const definition of createToolDefinitions(store, config, log)) {
    ctx.effect(() => ctx.tools.register(definition));
  }

  const maybeOff = (sessionId, trigger) => {
    try {
      const result = store.maybeOff(sessionId, trigger);
      if (result !== null) {
        log('auto-off', {
          sessionId,
          trigger,
          reason: result.reason,
          snapshot: result.snapshot,
        });
      }
      return result;
    } catch (error) {
      log('maybe-off-error', {
        sessionId,
        trigger,
        message: String(error?.message ?? error),
      });
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Core: replace quiet messages with one bubble per child, immediately queued.
  // ---------------------------------------------------------------------------
  ctx.on('agent/pre-step', async (payload, next) => {
    const agent = payload?.agent;
    const sessionId = agent?.session?.id;
    if (typeof sessionId === 'string') {
      try {
        store.noteStep(sessionId, payload.turn, payload.step);
      } catch {
        /* state bookkeeping must never break the step */
      }
    }

    const decision = await next();

    try {
      if (typeof sessionId !== 'string') return decision;
      if (decision === null || typeof decision !== 'object' || decision.kind !== 'enter') {
        return decision;
      }
      if (!Array.isArray(decision.messages)) return decision;
      if (store.get(sessionId) === undefined) return decision;

      const planned = store.plan(sessionId, {
        turn: payload.turn,
        step: payload.step,
        messages: decision.messages,
        turnStart: payload.step === 1,
      });

      if (planned.removeIds.length > 0) {
        const removed = new Set(planned.removeIds);
        decision.messages = decision.messages.filter(
          (message) => !removed.has(message?.id),
        );
      }

      applyActions(agent, sessionId, planned.actions, log, store);
      maybeOff(sessionId, 'delivery');
    } catch (error) {
      log('pre-step-error', {
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        message: String(error?.message ?? error),
      });
    }
    return decision;
  });

  // ---------------------------------------------------------------------------
  // Turn boundary: no-child / ttl fallback. v2 has no held rows to release.
  // ---------------------------------------------------------------------------
  ctx.on('agent/turn-stopping', (payload) => {
    const agent = payload?.agent;
    const sessionId = agent?.session?.id;
    if (typeof sessionId !== 'string') return;
    try {
      store.noteTurnStopping(sessionId, payload.turn);
      maybeOff(sessionId, 'turn-stop');
    } catch (error) {
      log('turn-stopping-error', {
        sessionId,
        message: String(error?.message ?? error),
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Child starts after arming: keep the arm alive while the child can still
  // produce a message or a settlement.
  // ---------------------------------------------------------------------------
  ctx.on('subagent/start', function subagentStart(info) {
    try {
      const childId = info?.id;
      if (typeof childId !== 'string') return;
      const matched = matchArmedParents(this, ctx, store);
      if (matched.length > 0) {
        for (const sessionId of matched) store.noteChildStart(sessionId, childId);
      } else {
        store.noteUnmatchedStart(childId);
      }
      log('subagent-start', {
        childId,
        provider: info?.provider,
        local: info?.local,
        matchedSessions: matched,
      });
    } catch (error) {
      log('subagent-start-error', { message: String(error?.message ?? error) });
    }
  });

  // A bubble deleted by the user must not be resurrected; clear its state and
  // evaluate auto-off (turn-stop also covers aborted turns without delivery).
  ctx.on('agent/inbox/discarded', (payload) => {
    const messageId = payload?.message?.id;
    if (typeof messageId !== 'string') return;
    if (store.queueItemSessions(messageId).length === 0) return;
    // `replace` and steer both emit discarded before/around the new occurrence.
    // Re-check after the current operation settles so a steer/edit is not
    // mistaken for a user deletion.
    queueMicrotask(() => {
      try {
        const affected = handleDiscarded(store, payload);
        for (const sessionId of affected) {
          log('queue-discarded', {
            sessionId,
            messageId,
            hasAgentPayload: typeof payload?.agent?.session?.id === 'string',
          });
          maybeOff(sessionId, 'turn-stop');
        }
      } catch (error) {
        log('discarded-error', { message: String(error?.message ?? error) });
      }
    });
  });

  ctx.on('agent/disposed', (payload) => {
    try {
      const sessionId = handleDisposed(store, payload);
      if (sessionId !== undefined) log('session-disposed', { sessionId });
    } catch (error) {
      log('disposed-error', { message: String(error?.message ?? error) });
    }
  });

  // Return an explicit cleanup for hosts that honor the apply() return value.
  return () => {
    store.dispose();
  };
}
