window.__ModuleLoader__.load({
  id: "dsh-quiet-subagents",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "quiet-subagents-ui";
    const NAMESPACE = "quiet-subagents";
    const PACKAGE = "dsh-quiet-subagents";

    const en = {
      title: "Quiet subagents",
      intro:
        "Quiet mode protects the current turn. Finish your own work, end the turn, and handle the child result next turn.",
      general: "General",
      behavior: "Delivery",
      pluginSwitch: "The main plugin switch is the row switch above. These options are saved to the profile and apply after DSH restarts.",
      loading: "Reading configuration…",
      readOnly: "This configuration is read-only.",
      saved: "Saved",
      failed: "Could not save",
      onlyCompleted: "Only defer completed children",
      onlyCompletedHint: "Failed or aborted settlements pass through immediately.",
      humanize: "Human-readable bubble",
      humanizeHint: "Off keeps the raw runtime text, including the child id.",
      debug: "Debug logging",
      debugHint: "Mirror plugin events to ctx.logger.info.",
      autoOff: "Turn off after the main session replies",
      autoOffHint:
        "On: turn off after the reply (replied). Off: turn off as soon as the bubble is delivered (delivered). Both still auto-off.",
      settledDelivery: "Settled delivery",
      settledCoalesce: "One merged bubble",
      settledAlways: "Always a separate finished bubble",
      settledNever: "No separate bubble when a message exists",
      language: "Language",
      langAuto: "Auto",
      langZh: "中文",
      langEn: "English",
      ttlTurns: "TTL turns",
      ttlHint: "Fallback when no child message arrives after arming.",
    };
    const zh = {
      title: "安静子代理",
      intro:
        "quiet 只保护当前主轮：主轮做完自己的事就结束，子代理结果下一轮再处理。",
      general: "基础选项",
      behavior: "交付策略",
      pluginSwitch: "插件总开关使用页面上方的开关。这里的选项保存到 profile，重启 DSH 后生效。",
      loading: "正在读取配置…",
      readOnly: "当前配置只读。",
      saved: "已保存",
      failed: "保存失败",
      onlyCompleted: "只延迟完成的子代理",
      onlyCompletedHint: "失败/中止的 settlement 直接放行。",
      humanize: "自然语言气泡",
      humanizeHint: "关闭后保留 raw runtime 文本（含子代理 id）。",
      debug: "调试日志",
      debugHint: "把插件事件镜像到 ctx.logger.info。",
      autoOff: "主会话回复后再解除",
      autoOffHint:
        "开启：回复后解除（replied）。关闭：气泡交付后立即解除（delivered）。两种情况都会自动解除。",
      settledDelivery: "完成通知方式",
      settledCoalesce: "合并为一条气泡",
      settledAlways: "始终单独一条完成气泡",
      settledNever: "有消息时不单独通知",
      language: "语言",
      langAuto: "自动",
      langZh: "中文",
      langEn: "English",
      ttlTurns: "TTL 轮数",
      ttlHint: "武装后迟迟没有子代理消息时的兜底轮数。",
    };

    const styles = {
      card: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "16px 18px",
        border: "0.5px solid var(--dsw-alias-border-l3)",
        borderRadius: "var(--dsw-radius-lg)",
        background: "var(--dsw-alias-bg-layer-2)",
      },
      head: { display: "flex", flexDirection: "column", gap: "4px" },
      title: {
        margin: 0,
        fontSize: 15,
        lineHeight: "22px",
        fontWeight: 600,
        color: "var(--dsw-alias-label-primary)",
      },
      intro: {
        margin: 0,
        fontSize: 12.5,
        lineHeight: "19px",
        color: "var(--dsw-alias-label-secondary)",
      },
      group: { display: "flex", flexDirection: "column", gap: "2px" },
      groupTitle: {
        margin: "8px 0 2px",
        fontSize: 12,
        lineHeight: "18px",
        fontWeight: 600,
        color: "var(--dsw-alias-label-tertiary)",
      },
      row: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "18px",
        padding: "10px 0",
        borderTop: "0.5px solid var(--dsw-alias-border-l2)",
      },
      rowMain: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 },
      rowTitle: {
        fontSize: 13.5,
        lineHeight: "20px",
        color: "var(--dsw-alias-label-primary)",
      },
      rowHint: {
        fontSize: 12,
        lineHeight: "18px",
        color: "var(--dsw-alias-label-tertiary)",
      },
      select: {
        minWidth: "170px",
        height: "30px",
        padding: "0 8px",
        borderRadius: "var(--dsw-radius-md)",
        border: "0.5px solid var(--dsw-alias-border-l3)",
        background: "var(--dsw-alias-bg-layer-1)",
        color: "var(--dsw-alias-label-primary)",
        fontSize: 12.5,
      },
      number: {
        width: "72px",
        height: "30px",
        padding: "0 8px",
        borderRadius: "var(--dsw-radius-md)",
        border: "0.5px solid var(--dsw-alias-border-l3)",
        background: "var(--dsw-alias-bg-layer-1)",
        color: "var(--dsw-alias-label-primary)",
        fontSize: 12.5,
      },
      note: {
        margin: 0,
        fontSize: 12,
        lineHeight: "18px",
        color: "var(--dsw-alias-label-tertiary)",
      },
      status: {
        fontSize: 12,
        lineHeight: "18px",
        color: "var(--dsw-alias-label-tertiary)",
      },
    };

    function row(title, hint, control) {
      return react.createElement(
        "div",
        { style: styles.row },
        react.createElement(
          "div",
          { style: styles.rowMain },
          react.createElement("div", { style: styles.rowTitle }, title),
          hint ? react.createElement("div", { style: styles.rowHint }, hint) : null,
        ),
        control,
      );
    }

    function QuietOptions(props) {
      const { form, t, view } = props;
      const [busy, setBusy] = react.useState(false);
      const [notice, setNotice] = react.useState(null);
      const snapshot = react.useSyncExternalStore(
        (listener) => form.subscribe(listener),
        () => form.getSnapshot(),
      );
      if (!form || view === "summary") return null;
      const value = snapshot.value ?? {};
      const disabled = !snapshot.writable || snapshot.status !== "ready" || busy;

      const save = async (field, next) => {
        setBusy(true);
        setNotice(null);
        let ok = false;
        try {
          ok = await form.set(field, next);
        } catch {
          ok = false;
        }
        setBusy(false);
        setNotice(ok ? "saved" : "failed");
      };

      if (snapshot.status === "loading") {
        return react.createElement("div", { style: styles.card }, t("loading"));
      }

      return react.createElement(
        "div",
        { style: styles.card },
        react.createElement(
          "div",
          { style: styles.head },
          react.createElement("h3", { style: styles.title }, t("title")),
          react.createElement("p", { style: styles.intro }, t("intro")),
          snapshot.writable
            ? react.createElement("p", { style: styles.note }, t("pluginSwitch"))
            : react.createElement("p", { style: styles.note }, t("readOnly")),
        ),
        react.createElement(
          "div",
          { style: styles.group },
          react.createElement("div", { style: styles.groupTitle }, t("general")),
          row(
            t("onlyCompleted"),
            t("onlyCompletedHint"),
            react.createElement(primitives.Switch, {
              checked: value.onlyCompleted !== false,
              label: t("onlyCompleted"),
              disabled,
              onChange: (next) => save("onlyCompleted", next),
            }),
          ),
          row(
            t("humanize"),
            t("humanizeHint"),
            react.createElement(primitives.Switch, {
              checked: value.humanize !== false,
              label: t("humanize"),
              disabled,
              onChange: (next) => save("humanize", next),
            }),
          ),
          row(
            t("autoOff"),
            t("autoOffHint"),
            react.createElement(primitives.Switch, {
              checked: value.autoOff === "replied",
              label: t("autoOff"),
              disabled,
              onChange: (next) => save("autoOff", next ? "replied" : "delivered"),
            }),
          ),
        ),
        react.createElement(
          "div",
          { style: styles.group },
          react.createElement("div", { style: styles.groupTitle }, t("behavior")),
          row(
            t("settledDelivery"),
            null,
            react.createElement(
              "select",
              {
                style: styles.select,
                value: value.settledDelivery ?? "coalesce",
                disabled,
                onChange: (event) => save("settledDelivery", event.target.value),
              },
              react.createElement("option", { value: "coalesce" }, t("settledCoalesce")),
              react.createElement("option", { value: "always" }, t("settledAlways")),
              react.createElement("option", { value: "never" }, t("settledNever")),
            ),
          ),
          row(
            t("language"),
            null,
            react.createElement(
              "select",
              {
                style: styles.select,
                value: value.language ?? "auto",
                disabled,
                onChange: (event) => save("language", event.target.value),
              },
              react.createElement("option", { value: "auto" }, t("langAuto")),
              react.createElement("option", { value: "zh" }, t("langZh")),
              react.createElement("option", { value: "en" }, t("langEn")),
            ),
          ),
          row(
            t("ttlTurns"),
            t("ttlHint"),
            react.createElement("input", {
              style: styles.number,
              type: "number",
              min: 1,
              step: 1,
              value: value.ttlTurns ?? 3,
              disabled,
              onChange: (event) => {
                const next = Number(event.target.value);
                if (Number.isSafeInteger(next) && next > 0) save("ttlTurns", next);
              },
            }),
          ),
          row(
            t("debug"),
            t("debugHint"),
            react.createElement(primitives.Switch, {
              checked: value.debug === true,
              label: t("debug"),
              disabled,
              onChange: (next) => save("debug", next),
            }),
          ),
        ),
        notice
          ? react.createElement(
              "p",
              { style: styles.status, role: "status" },
              t(notice === "saved" ? "saved" : "failed"),
            )
          : null,
      );
    }

    const inject = ["slots", "locale", "configForms"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), "quiet-subagents: locale");
      const t = ctx.locale.bind(NS);
      const form = ctx.configForms.get(NAMESPACE);
      ctx.effect(() =>
        ctx.configForms.whileServed([NAMESPACE], () =>
          ctx.slots.inject("plugins.bundle.config", () =>
            ctx.slots.register(
              {
                name: "plugins.bundle.config",
                key: PACKAGE,
                locale: NS,
                inject: () => ({ form, t }),
              },
              QuietOptions,
            ),
          ),
        ),
      );
    }

    exports.name = "quiet-subagents-ui";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
