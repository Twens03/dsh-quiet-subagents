/**
 * Pure state machine for dsh-quiet-subagents v2.
 *
 * v2 semantics (HANDOFF §11/§12): a quiet main session immediately queues one
 * human-readable bubble per child (`agent.followup`), merges later messages,
 * and refreshes the same `next-turn` item in place when the child settles.
 * There is no held/inflight staging: the bubble is visible in QueueDock while
 * the main turn runs. All state is per session and per direct child.
 *
 * No runtime imports: this module is unit-testable with plain `node test/unit.mjs`
 * and can be loaded by the Host plugin without resolving a bare package name.
 */

/** Source kinds owned by subagent orchestration that quiet mode may handle. */
export const QUIET_SOURCE_KINDS = Object.freeze(['agent-message', 'subagent-settled']);

/**
 * Settlement summaries for non-completed endings, as rendered by
 * @deepseek-ai/dsh-subagent `settlementSummary()`.
 */
const FAILED_SETTLEMENT_RE =
  /(was stopped before|ran out of room|declined the task|failed before|ended abnormally)/i;

const TEXT = Object.freeze({
  zh: {
    message: '子代理消息',
    finished: '子代理工作完成',
    hint: '（自动推送，请勿编辑和删除）',
    noOutput: '（子代理没有返回文本输出）',
  },
  en: {
    message: 'Subagent message',
    finished: 'Subagent finished',
    hint: '(Auto-delivered — please do not edit or delete.)',
    noOutput: '(Subagent returned no text output.)',
  },
});

/** @param {unknown} message */
export function isQuietCandidate(message) {
  const kind = message?.source?.kind;
  return kind === 'agent-message' || kind === 'subagent-settled';
}

/** @param {unknown} message */
export function settlementSummaryOf(message) {
  const summary = message?.source?.summary;
  if (typeof summary === 'string' && summary.length > 0) return summary;
  const blocks = textBlockTexts(message);
  return blocks[0] ?? '';
}

/**
 * Whether a settlement notice describes a completed child. A failed/aborted
 * settlement is not quieted when `onlyCompleted` is on.
 * @param {unknown} message
 */
export function settlementIsCompleted(message) {
  const summary = settlementSummaryOf(message);
  if (summary.length === 0) return true;
  return !FAILED_SETTLEMENT_RE.test(summary);
}

/**
 * @param {unknown} message
 * @param {{ onlyCompleted: boolean }} config
 */
export function shouldDefer(message, config) {
  if (!isQuietCandidate(message)) return false;
  if (message.source.kind === 'subagent-settled' && config.onlyCompleted) {
    return settlementIsCompleted(message);
  }
  return true;
}

/** Resolve a Schemastery live config ref, or return a plain value unchanged. */
function configValue(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value;
}

/** @param {unknown} raw */
export function normalizeConfig(raw) {
  const cfg = raw !== null && typeof raw === 'object' ? raw : {};
  const enabled = configValue(cfg.enabled);
  const onlyCompleted = configValue(cfg.onlyCompleted);
  const autoOff = configValue(cfg.autoOff);
  const ttlTurns = configValue(cfg.ttlTurns);
  const settledDelivery = configValue(cfg.settledDelivery);
  const humanize = configValue(cfg.humanize);
  const language = configValue(cfg.language);
  const debug = configValue(cfg.debug);
  const logFile = configValue(cfg.logFile);
  return {
    enabled: enabled !== false,
    onlyCompleted: onlyCompleted !== false,
    autoOff: autoOff === 'replied' ? 'replied' : 'delivered',
    ttlTurns: Number.isSafeInteger(ttlTurns) && ttlTurns > 0 ? ttlTurns : 3,
    settledDelivery:
      settledDelivery === 'always' || settledDelivery === 'never'
        ? settledDelivery
        : 'coalesce',
    humanize: humanize !== false,
    language: language === 'zh' || language === 'en' ? language : 'auto',
    debug: debug === true,
    logFile:
      typeof logFile === 'string' && logFile.length > 0 ? logFile : undefined,
  };
}

/** @param {unknown} agent */
export function isSubagentSession(agent) {
  return agent?.session?.header?.parentSession !== undefined;
}

/**
 * Host-side language detection. QueueDock follows the client UI language, but
 * the Host plugin has no client locale service (HANDOFF §11.6); this is the
 * documented approximation (`Intl` / LANG), overridable via config.language.
 */
export function detectLanguage(env = globalThis.process?.env ?? {}) {
  let locale = '';
  try {
    locale = new Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  } catch {
    /* Intl is optional in exotic hosts */
  }
  if (!/^zh/i.test(locale)) {
    const raw = env.LC_ALL ?? env.LANG ?? env.LANGUAGE ?? '';
    if (/^zh/i.test(raw)) locale = raw;
  }
  return /^zh/i.test(locale) ? 'zh' : 'en';
}

/** @param {ReturnType<typeof normalizeConfig>} config @param {string} locale */
export function resolveLanguage(config, locale) {
  if (config.language === 'zh' || config.language === 'en') return config.language;
  return /^zh/i.test(locale ?? '') ? 'zh' : 'en';
}

/** Text blocks of a message, in order. @param {unknown} message */
export function textBlockTexts(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
}

/** Join all text blocks of a message. @param {unknown} message */
export function messageText(message) {
  return textBlockTexts(message).join('\n\n').trim();
}

/**
 * Remove the raw `Agent <id> sent a message: ` prefix from the first block.
 * The runtime prefix is exact (`dsh-subagent/lib/index.js`):
 * `Agent ${sender.id} sent a message: `.
 * @param {string} text
 * @param {string} [childId]
 */
export function stripAgentPrefix(text, childId) {
  if (typeof childId === 'string' && childId.length > 0) {
    const exact = `Agent ${childId} sent a message: `;
    if (text.startsWith(exact)) return text.slice(exact.length).trim();
  }
  const match = /^Agent\s+\S+\s+sent a message:\s*/i.exec(text);
  return match ? text.slice(match[0].length).trim() : text.trim();
}

/**
 * Extract the child's closing text from a runtime settlement message. The
 * runtime content is: [summary, "Its closing message:", ...closing blocks,
 * optional "Structured result: ...", optional diagnostic]. We intentionally
 * drop the UUID-bearing summary line.
 * @param {unknown} message
 */
export function closingTextOf(message) {
  const blocks = textBlockTexts(message);
  if (blocks.length === 0) return '';
  let start = 0;
  if (/^Background subagent\b/i.test(blocks[0].trim())) start = 1;
  const out = [];
  for (let index = start; index < blocks.length; index += 1) {
    const value = blocks[index].trim();
    if (/^Its closing message:\s*$/i.test(value)) continue;
    if (/^It left no closing message\.?\s*$/i.test(value)) continue;
    out.push(blocks[index]);
  }
  return out.join('\n\n').trim();
}

/**
 * Merge two text fragments without duplicating a fragment already present.
 * @param {string} existing
 * @param {string} incoming
 */
export function mergeText(existing, incoming) {
  const left = typeof existing === 'string' ? existing.trim() : '';
  const right = typeof incoming === 'string' ? incoming.trim() : '';
  if (right.length === 0) return left;
  if (left.length === 0) return right;
  if (left.includes(right)) return left;
  if (right.includes(left)) return right;
  return `${left}\n\n${right}`;
}

/** Unique id for a plugin-authored queue bubble (never reuse the claimed id). */
function defaultNewId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `quiet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param {string} haystack @param {string} needle */
function containsText(haystack, needle) {
  const value = typeof needle === 'string' ? needle.trim() : '';
  if (value.length === 0) return true;
  return (typeof haystack === 'string' ? haystack : '').includes(value);
}

/**
 * Session-scoped quiet state store (v2).
 */
export class QuietStore {
  /**
   * @param {ReturnType<typeof normalizeConfig>} config
   * @param {{ now?: () => number, onEvent?: (event: string, detail?: object) => void, locale?: string, newId?: () => string }} [hooks]
   */
  constructor(config, hooks = {}) {
    this.config = config;
    this.now = hooks.now ?? (() => Date.now());
    this.newId = hooks.newId ?? defaultNewId;
    this.onEvent = hooks.onEvent ?? (() => {});
    this.language = resolveLanguage(config, hooks.locale ?? detectLanguage());
    /** @type {Map<string, any>} */
    this.sessions = new Map();
    /** Last off record per session, kept so quiet_status can explain the ending. */
    this.lastOff = new Map();
    /** @type {Map<string, {turn: number, step: number}>} */
    this.lastStep = new Map();
    /** Fallback for `subagent/start` edges whose carrier could not be matched. */
    this.unmatchedStarts = [];
  }

  emit(event, detail) {
    try {
      this.onEvent(event, detail);
    } catch {
      /* logging must never change behavior */
    }
  }

  /** @param {string} sessionId */
  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  /** Session ids that currently hold quiet state. */
  armedSessionIds() {
    return [...this.sessions.keys()];
  }

  /** @param {string} sessionId */
  lastStepOf(sessionId) {
    return this.lastStep.get(sessionId);
  }

  /** Remember every agent's last proposed step so quiet_on() can learn its turn. */
  noteStep(sessionId, turn, step) {
    const prev = this.lastStep.get(sessionId);
    this.lastStep.set(sessionId, { turn, step });
    return prev;
  }

  /** @param {string} childId */
  newChild(childId) {
    return {
      childId,
      header: 'message',
      resultText: '',
      closingText: '',
      settled: false,
      sawMessage: false,
      userEdited: false,
      discarded: false,
      items: new Map(),
      queueItemId: undefined,
    };
  }

  /** @param {any} state @param {string} childId */
  ensureChild(state, childId) {
    let child = state.children.get(childId);
    if (child === undefined) {
      child = this.newChild(childId);
      state.children.set(childId, child);
      this.emit('child-observed', { sessionId: state.sessionId, childId });
    }
    return child;
  }

  /** Reset one child to a fresh interaction after the previous bubble delivered. */
  resetChild(child) {
    child.header = 'message';
    child.resultText = '';
    child.closingText = '';
    child.settled = false;
    child.sawMessage = false;
    child.userEdited = false;
    child.discarded = false;
    child.items.clear();
    child.queueItemId = undefined;
  }

  /**
   * Arm quiet mode for one main session. Re-arming an already-quiet session is
   * a no-op (it must not drop bubbles already queued).
   * @param {string} sessionId
   * @param {number} turn
   */
  arm(sessionId, turn) {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) return { state: existing, created: false };
    const at = this.now();
    const state = {
      sessionId,
      armedAt: at,
      armedTurn: turn,
      turn,
      children: new Map(),
      delivered: 0,
      awaitingReply: false,
      deliveryTurn: undefined,
    };
    this.sessions.set(sessionId, state);
    this.emit('arm', {
      sessionId,
      armedTurn: turn,
      config: {
        onlyCompleted: this.config.onlyCompleted,
        autoOff: this.config.autoOff,
        ttlTurns: this.config.ttlTurns,
        settledDelivery: this.config.settledDelivery,
        humanize: this.config.humanize,
        language: this.language,
      },
    });
    return { state, created: true };
  }

  /**
   * Remove quiet state. Queued bubbles intentionally stay in the runtime
   * `next-turn` queue and are delivered normally.
   * @param {string} sessionId
   * @param {string} reason
   */
  disarm(sessionId, reason) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) return undefined;
    this.sessions.delete(sessionId);
    const snapshot = this.snapshotOf(state);
    this.recordOff(sessionId, reason, snapshot, true);
    this.emit('off', { sessionId, reason, manual: true, ...snapshot });
    return snapshot;
  }

  /** Keep the ending visible to a later quiet_status call. */
  recordOff(sessionId, reason, snapshot, manual) {
    this.lastOff.set(sessionId, {
      reason,
      manual,
      at: this.now(),
      phase: snapshot.phase,
      armedTurn: snapshot.armedTurn,
      delivered: snapshot.delivered,
      pendingQueueCount: snapshot.pendingQueueCount,
    });
    if (this.lastOff.size > 50) {
      const oldest = this.lastOff.keys().next().value;
      this.lastOff.delete(oldest);
    }
  }

  /** @param {string} sessionId */
  forget(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.lastStep.delete(sessionId);
      return;
    }
    const state = this.sessions.get(sessionId);
    const snapshot = this.snapshotOf(state);
    this.sessions.delete(sessionId);
    this.lastStep.delete(sessionId);
    this.recordOff(sessionId, 'session-disposed', snapshot, false);
    this.emit('off', { sessionId, reason: 'session-disposed', ...snapshot });
  }

  /** @param {string} sessionId @param {string} childId */
  noteChildStart(sessionId, childId) {
    const state = this.sessions.get(sessionId);
    if (state === undefined || typeof childId !== 'string') return false;
    const first = !state.children.has(childId);
    const child = this.ensureChild(state, childId);
    if (child.settled) return false;
    if (first) this.emit('child-start', { sessionId, childId });
    return first;
  }

  /** Record a start edge whose parent carrier could not be resolved. */
  noteUnmatchedStart(childId) {
    const at = this.now();
    this.unmatchedStarts.push({ childId, at });
    if (this.unmatchedStarts.length > 200) this.unmatchedStarts.shift();
    this.emit('child-start-unmatched', { childId, at });
  }

  /** @param {number} at */
  hasUnmatchedStartSince(at) {
    return this.unmatchedStarts.some((entry) => entry.at >= at);
  }

  /** @param {any} child */
  pendingItems(child) {
    return [...child.items.values()].filter(
      (item) => item.delivered !== true && item.discarded !== true,
    );
  }

  /** @param {any} child */
  pendingMessageItem(child) {
    return this.pendingItems(child).find((item) => item.header === 'message');
  }

  /** @param {any} child */
  pendingFinishedItem(child) {
    return this.pendingItems(child).find((item) => item.header === 'finished');
  }

  /** @param {any} child */
  nextPendingId(child) {
    return this.pendingItems(child)[0]?.id;
  }

  /**
   * @param {any} child @param {string} id @param {'message'|'finished'} header @param {string} text
   */
  addItem(child, id, header, text) {
    const item = {
      id,
      header,
      text,
      delivered: false,
      discarded: false,
      previousText: undefined,
    };
    child.items.set(id, item);
    child.queueItemId = id;
    child.header = header;
    return item;
  }

  /** @param {any} child @param {string} id */
  markItemDelivered(child, id) {
    const item = child.items.get(id);
    if (item === undefined) return false;
    item.delivered = true;
    if (child.queueItemId === id) child.queueItemId = this.nextPendingId(child);
    return true;
  }

  /** @param {any} state @param {string} id */
  findItem(state, id) {
    for (const child of state.children.values()) {
      const item = child.items.get(id);
      if (item !== undefined) return { child, item };
    }
    return null;
  }

  /**
   * Apply the evidence a delivered/seen message carries about its child.
   * @param {any} state @param {any} message
   */
  observeChildEvidence(state, message) {
    const childId = message?.source?.senderSessionId;
    if (typeof childId !== 'string' || childId.length === 0) return undefined;
    const child = this.ensureChild(state, childId);
    const kind = message?.source?.kind;
    if (kind === 'subagent-settled') {
      child.settled = true;
      const closing = this.config.humanize ? closingTextOf(message) : messageText(message);
      if (closing.length > 0 && !containsText(child.closingText, closing)) {
        child.closingText = mergeText(child.closingText, closing);
      }
    } else if (kind === 'agent-message') {
      child.sawMessage = true;
    }
    return child;
  }

  /** @param {string} sessionId @param {string} childId */
  markUserEdited(sessionId, childId) {
    const state = this.sessions.get(sessionId);
    const child = state?.children.get(childId);
    if (child === undefined) return false;
    child.userEdited = true;
    this.emit('user-edited', { sessionId, childId });
    return true;
  }

  /** Session ids that currently own a queue item with this id. */
  queueItemSessions(messageId) {
    const out = [];
    for (const [sessionId, state] of this.sessions) {
      if (this.findItem(state, messageId) !== null) out.push(sessionId);
    }
    return out;
  }

  /** @param {string} sessionId @param {string} messageId */
  discardQueueItem(sessionId, messageId) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) return false;
    const hit = this.findItem(state, messageId);
    if (hit === null) return false;
    if (hit.item.delivered) return false; // already claimed; a steer is a delivery
    hit.item.discarded = true;
    hit.child.discarded = true;
    if (hit.child.queueItemId === messageId) {
      hit.child.queueItemId = this.nextPendingId(hit.child);
    }
    this.emit('discard', { sessionId, messageId, childId: hit.child.childId });
    return true;
  }

  /** @param {string} sessionId @param {string} messageId */
  isDeferred(sessionId, messageId) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) return false;
    return this.findItem(state, messageId) !== null;
  }

  /** @param {string} sessionId @param {string} messageId */
  undefer(sessionId, messageId) {
    return this.discardQueueItem(sessionId, messageId);
  }

  /** @param {'message'|'finished'} header @param {string} body */
  render(header, body) {
    const text = TEXT[this.language] ?? TEXT.en;
    const title = header === 'finished' ? text.finished : text.message;
    const content = typeof body === 'string' ? body.trim() : '';
    return content.length > 0
      ? `${title}\n${text.hint}\n\n${content}`
      : `${title}\n${text.hint}`;
  }

  /** @returns {string} */
  noOutputText() {
    return (TEXT[this.language] ?? TEXT.en).noOutput;
  }

  /** @param {any} original @param {string} text @param {string} [id] */
  buildMessage(original, text, id = original?.id) {
    return {
      ...original,
      ...(typeof id === 'string' ? { id } : {}),
      content: [{ type: 'text', text }],
    };
  }

  /**
   * Classify one claimed step batch and update state.
   *
   * Actions are IO requests for index.js:
   *   - followup: agent.followup(action.message)
   *   - replace:  agent.inbox.replace(action.messageId, action.message)
   * The caller removes `removeIds` from decision.messages.
   *
   * @param {string} sessionId
   * @param {{ turn: number, step: number, messages: any[], turnStart: boolean }} input
   * @returns {{ keep: any[], actions: any[], removeIds: string[], delivered: number }}
   */
  plan(sessionId, input) {
    const state = this.sessions.get(sessionId);
    const messages = Array.isArray(input.messages) ? input.messages : [];
    if (state === undefined) return { keep: messages, actions: [], removeIds: [], delivered: 0 };
    state.turn = input.turn;
    const keep = [];
    const actions = [];
    const removeIds = [];
    let delivered = 0;

    for (const message of messages) {
      if (!isQuietCandidate(message)) {
        keep.push(message);
        continue;
      }
      const kind = message.source.kind;
      const childId =
        typeof message.source.senderSessionId === 'string'
          ? message.source.senderSessionId
          : 'unknown';
      const id = typeof message.id === 'string' ? message.id : undefined;

      if (!shouldDefer(message, this.config)) {
        // onlyCompleted: a failed/aborted settlement passes through immediately.
        this.observeChildEvidence(state, message);
        keep.push(message);
        this.emit('pass-failed-settlement', {
          sessionId,
          messageId: id,
          childId,
          summary: settlementSummaryOf(message),
          turn: input.turn,
          step: input.step,
        });
        continue;
      }

      if (input.turnStart) {
        const hit = id === undefined ? null : this.findItem(state, id);
        let child;
        if (hit !== null) {
          child = hit.child;
          this.markItemDelivered(child, id);
        } else {
          child = this.ensureChild(state, childId);
          if (kind === 'agent-message') {
            child.sawMessage = true;
            const raw = messageText(message);
            const body = this.config.humanize ? stripAgentPrefix(raw, childId) : raw;
            child.resultText = mergeText(child.resultText, body);
          }
          if (kind === 'subagent-settled') child.settled = true;
          if (id !== undefined) {
            const item = this.addItem(
              child,
              id,
              kind === 'subagent-settled' ? 'finished' : 'message',
              messageText(message),
            );
            item.delivered = true;
            if (child.queueItemId === id) child.queueItemId = this.nextPendingId(child);
          }
        }
        delivered += 1;
        keep.push(message);
        this.emit(hit === null ? 'deliver-unqueued' : 'deliver', {
          sessionId,
          messageId: id,
          kind,
          childId,
          turn: input.turn,
          step: input.step,
        });
        continue;
      }

      // A user steer moves the same humanized bubble from next-turn to
      // next-step; a mid-turn claim of our own item id is a delivery.
      const steered = id === undefined ? null : this.findItem(state, id);
      if (steered !== null) {
        this.markItemDelivered(steered.child, id);
        delivered += 1;
        keep.push(message);
        this.emit('deliver-steer', {
          sessionId,
          messageId: id,
          childId: steered.child.childId,
          turn: input.turn,
          step: input.step,
        });
        continue;
      }

      if (kind === 'agent-message') {
        if (id === undefined) {
          keep.push(message);
          continue;
        }
        const child = this.ensureChild(state, childId);
        const raw = messageText(message);
        const body = this.config.humanize ? stripAgentPrefix(raw, childId) : raw;
        const pending = this.pendingMessageItem(child);
        if (pending !== undefined) {
          const before = pending.text;
          child.resultText = mergeText(child.resultText, body);
          const text = this.render('message', child.resultText);
          pending.text = text;
          pending.previousText = before;
          child.queueItemId = pending.id;
          child.header = 'message';
          actions.push({
            kind: 'replace',
            messageId: pending.id,
            childId,
            message: this.buildMessage(message, text, pending.id),
            appendText: body,
            previousText: before,
          });
        } else {
          if (child.items.size > 0 || child.settled) this.resetChild(child);
          child.sawMessage = true;
          child.resultText = body;
          child.settled = false;
          child.closingText = '';
          child.discarded = false;
          const text = this.render('message', body);
          const queueId = this.newId();
          this.addItem(child, queueId, 'message', text);
          actions.push({
            kind: 'followup',
            messageId: queueId,
            childId,
            message: this.buildMessage(message, text, queueId),
            text,
          });
        }
        removeIds.push(id);
        this.emit('queue-message', {
          sessionId,
          messageId: id,
          childId,
          header: 'message',
          turn: input.turn,
          step: input.step,
        });
        continue;
      }

      // subagent-settled
      const child = this.ensureChild(state, childId);
      child.settled = true;
      const rawClosing = this.config.humanize
        ? closingTextOf(message)
        : messageText(message);
      const closing = typeof rawClosing === 'string' ? rawClosing.trim() : '';
      const isNew =
        closing.length > 0 &&
        !containsText(child.resultText, closing) &&
        !containsText(child.closingText, closing);
      if (isNew) child.closingText = mergeText(child.closingText, closing);

      if (child.discarded) {
        if (id !== undefined) removeIds.push(id);
        this.emit('settled-ignored', { sessionId, childId, messageId: id });
        continue;
      }

      const mode = this.config.settledDelivery;
      if (mode === 'always') {
        if (id === undefined) {
          keep.push(message);
          continue;
        }
        const body = closing.length > 0 ? closing : this.noOutputText();
        const text = this.render('finished', body);
        const queueId = this.newId();
        this.addItem(child, queueId, 'finished', text);
        actions.push({
          kind: 'followup',
          messageId: queueId,
          childId,
          message: this.buildMessage(message, text, queueId),
          text,
        });
        removeIds.push(id);
      } else if (mode === 'never') {
        if (!child.sawMessage) {
          this.planOnlySettled(child, message, id, closing, actions, removeIds, keep);
        } else {
          const pending = this.pendingMessageItem(child);
          if (pending !== undefined && isNew) {
            const before = pending.text;
            const text = this.render(
              'message',
              mergeText(child.resultText, child.closingText),
            );
            pending.text = text;
            pending.previousText = before;
            child.queueItemId = pending.id;
            child.header = 'message';
            actions.push({
              kind: 'replace',
              messageId: pending.id,
              childId,
              message: this.buildMessage(message, text, pending.id),
              appendText: closing,
              previousText: before,
            });
            removeIds.push(id);
          } else if (pending !== undefined) {
            if (id !== undefined) removeIds.push(id);
          } else if (isNew) {
            // The original bubble was already claimed; keep the information in
            // a short finished bubble rather than losing the closing text.
            this.planShortFinished(child, message, id, closing, actions, removeIds, keep);
          } else if (id !== undefined) {
            removeIds.push(id);
          }
        }
      } else {
        const pending =
          this.pendingMessageItem(child) ?? this.pendingFinishedItem(child);
        if (pending !== undefined) {
          const before = pending.text;
          const text = this.render(
            'finished',
            mergeText(child.resultText, child.closingText),
          );
          pending.header = 'finished';
          pending.text = text;
          pending.previousText = before;
          child.queueItemId = pending.id;
          child.header = 'finished';
          actions.push({
            kind: 'replace',
            messageId: pending.id,
            childId,
            message: this.buildMessage(message, text, pending.id),
            appendText: isNew ? closing : '',
            previousText: before,
          });
          removeIds.push(id);
        } else if (child.sawMessage && isNew) {
          this.planShortFinished(child, message, id, closing, actions, removeIds, keep);
        } else if (!child.sawMessage) {
          this.planOnlySettled(child, message, id, closing, actions, removeIds, keep);
        } else if (id !== undefined) {
          removeIds.push(id);
        }
      }
      this.emit('settled', {
        sessionId,
        messageId: id,
        childId,
        header: child.header,
        mode,
        newClosing: isNew,
      });
    }

    state.delivered += delivered;
    return { keep, actions, removeIds, delivered };
  }

  /**
   * Helpers for settled-only / short-finished branches.
   * @param {any} child @param {any} message @param {string|undefined} id
   * @param {string} closing @param {any[]} actions @param {string[]} removeIds @param {any[]} keep
   */
  planOnlySettled(child, message, id, closing, actions, removeIds, keep) {
    if (id === undefined) {
      keep.push(message);
      return;
    }
    const pending = this.pendingFinishedItem(child);
    const body = closing.length > 0 ? closing : this.noOutputText();
    if (pending !== undefined) {
      const before = pending.text;
      const text = this.render('finished', body);
      pending.text = text;
      pending.previousText = before;
      actions.push({
        kind: 'replace',
        messageId: pending.id,
        childId: child.childId,
        message: this.buildMessage(message, text, pending.id),
        appendText: closing,
        previousText: before,
      });
    } else {
      const text = this.render('finished', body);
      const queueId = this.newId();
      this.addItem(child, queueId, 'finished', text);
      actions.push({
        kind: 'followup',
        messageId: queueId,
        childId: child.childId,
        message: this.buildMessage(message, text, queueId),
        text,
      });
    }
    removeIds.push(id);
  }

  /**
   * @param {any} child @param {any} message @param {string|undefined} id
   * @param {string} closing @param {any[]} actions @param {string[]} removeIds @param {any[]} keep
   */
  planShortFinished(child, message, id, closing, actions, removeIds, keep) {
    if (id === undefined) {
      keep.push(message);
      return;
    }
    const text = this.render('finished', closing.length > 0 ? closing : this.noOutputText());
    const queueId = this.newId();
    this.addItem(child, queueId, 'finished', text);
    actions.push({
      kind: 'followup',
      messageId: queueId,
      childId: child.childId,
      message: this.buildMessage(message, text, queueId),
      text,
    });
    removeIds.push(id);
  }

  /** @param {string} sessionId @param {number} turn */
  noteTurnStopping(sessionId, turn) {
    const state = this.sessions.get(sessionId);
    if (state !== undefined) state.turn = turn;
  }

  /**
   * Evaluate the next auto-off condition.
   * @param {string} sessionId
   * @param {'delivery' | 'turn-stop'} trigger
   * @returns {{ reason: string, snapshot: object } | null}
   */
  maybeOff(sessionId, trigger) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) return null;

    const children = [...state.children.values()];
    const pending = children.some((child) => this.pendingItems(child).length > 0);
    if (pending) return null;

    const unsettled = children.some((child) => child.settled !== true);
    if (unsettled) {
      if (state.turn - state.armedTurn >= this.config.ttlTurns) {
        return this.finish(state, 'ttl');
      }
      return null;
    }

    if (children.length === 0) {
      if (
        trigger === 'turn-stop' &&
        state.turn === state.armedTurn &&
        !this.hasUnmatchedStartSince(state.armedAt)
      ) {
        return this.finish(state, 'no-child');
      }
      if (state.turn - state.armedTurn >= this.config.ttlTurns) {
        return this.finish(state, 'ttl');
      }
      return null;
    }

    if (this.config.autoOff === 'replied') {
      if (trigger === 'delivery') {
        if (state.delivered > 0 && !state.awaitingReply) {
          state.awaitingReply = true;
          state.deliveryTurn = state.turn;
          this.emit('awaiting-reply', {
            sessionId,
            turn: state.turn,
            delivered: state.delivered,
          });
        }
        return null;
      }
      if (trigger === 'turn-stop') {
        return this.finish(state, state.delivered > 0 ? 'replied' : 'settled');
      }
      return null;
    }

    return this.finish(state, state.delivered > 0 ? 'delivered' : 'settled');
  }

  /** @param {any} state @param {string} reason */
  finish(state, reason) {
    const snapshot = this.snapshotOf(state);
    this.sessions.delete(state.sessionId);
    this.recordOff(state.sessionId, reason, snapshot, false);
    this.emit('off', {
      sessionId: state.sessionId,
      reason,
      manual: false,
      ...snapshot,
    });
    return { reason, snapshot };
  }

  /** @param {any} state */
  snapshotOf(state) {
    const children = [...state.children.values()];
    const items = children.flatMap((child) => [...child.items.values()]);
    const pendingQueueCount = children.reduce(
      (count, child) => count + this.pendingItems(child).length,
      0,
    );
    const settledCount = children.filter((child) => child.settled).length;
    let phase = 'armed';
    if (pendingQueueCount > 0 || (children.length > 0 && settledCount < children.length)) {
      phase = 'active';
    } else if (children.length > 0 || state.delivered > 0) {
      phase = 'draining';
    }
    return {
      phase,
      sessionId: state.sessionId,
      armedTurn: state.armedTurn,
      currentTurn: state.turn,
      childrenCount: children.length,
      settledCount,
      queueItemCount: items.length,
      pendingQueueCount,
      // Per-child summary deliberately omits child ids/UUIDs (HANDOFF §11.2.7).
      children: children.map((child, index) => ({
        index: index + 1,
        header: child.header,
        settled: child.settled,
        delivered:
          child.items.size > 0 &&
          [...child.items.values()].every((item) => item.delivered || item.discarded),
        pendingItems: this.pendingItems(child).length,
        queueItems: child.items.size,
        userEdited: child.userEdited,
        dismissed: child.discarded,
      })),
      delivered: state.delivered,
      awaitingReply: state.awaitingReply,
    };
  }

  /** @param {string} sessionId */
  snapshot(sessionId) {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      const last = this.lastOff.get(sessionId);
      return {
        phase: 'off',
        sessionId,
        armedTurn: last?.armedTurn ?? undefined,
        currentTurn: this.lastStep.get(sessionId)?.turn,
        offReason: last?.reason ?? null,
        offAt: last?.at ?? null,
        lastDelivered: last?.delivered ?? 0,
        childrenCount: 0,
        settledCount: 0,
        queueItemCount: 0,
        pendingQueueCount: 0,
        children: [],
        delivered: last?.delivered ?? 0,
        awaitingReply: false,
      };
    }
    return this.snapshotOf(state);
  }

  dispose() {
    this.sessions.clear();
    this.lastOff.clear();
    this.lastStep.clear();
    this.unmatchedStarts.length = 0;
  }
}
