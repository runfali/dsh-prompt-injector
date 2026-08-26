window.__ModuleLoader__.load({
  id: "dsh-prompt-injector",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let react = require("react");
    let jsxRuntime = require("react/jsx-runtime");
    let jsx = jsxRuntime.jsx;
    let jsxs = jsxRuntime.jsxs;
    let useState = react.useState;
    let useSyncExternalStore = react.useSyncExternalStore;

    const NS = "prompt-injector";

    // ---- 最小快照 store ----
    function createStore(init) {
      let state = init;
      const listeners = new Set();
      return {
        getSnapshot() { return state; },
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        set(next) { state = next; listeners.forEach((fn) => fn()); }
      };
    }

    // ---- 字段规格 ----
    // type: bool（开关）| list（提示词数组）。list 为自定义渲染（PromptsEditor）。
    const FIELDS = [
      { key: "enabled", type: "bool" },
      { key: "skipTrivial", type: "bool" },
      { key: "prompts", type: "list" }
    ];

    function parseFieldValue(field, raw) {
      if (field.type === "list") {
        if (!Array.isArray(raw)) return { invalid: true, raw };
        const cleaned = raw
          .map((p) => ({
            id: String((p && p.id) || ""),
            title: String((p && p.title) || ""),
            text: String((p && p.text) || ""),
            enabled: !(p && p.enabled === false)
          }))
          .filter((p) => p.title !== "" || p.text !== "");
        return { value: cleaned };
      }
      if (field.type === "bool") {
        return { value: raw === true };
      }
      return { value: String(raw === undefined || raw === null ? "" : raw) };
    }

    // ---- 表单控制器：staging + revision-fenced scope 写入（同构 dsh-mem0-plugins）----
    function PIForm(scope) {
      this.scope = scope;
      this.staged = new Map();
      this.listeners = new Set();
      this.saving = false;
      this.failed = false;
      const self = this;
      this.store = createStore(this.projection());
      this.listeners.add(() => { this.store.set(this.projection()); });
    }
    PIForm.prototype.publish = function () { this.listeners.forEach((fn) => fn()); };
    PIForm.prototype.snapshotOf = function () { return this.scope.getSnapshot(); };
    PIForm.prototype.sectionValue = function (key) {
      const v = this.snapshotOf().value;
      return v === undefined || v === null ? undefined : v[key];
    };
    PIForm.prototype.userLayer = function () { return this.snapshotOf().user; };
    PIForm.prototype.stored = function (key) {
      const user = this.userLayer();
      return user !== undefined && user !== null && Object.prototype.hasOwnProperty.call(user, key);
    };
    PIForm.prototype.spec = function (key) { return FIELDS.find((f) => f.key === key); };
    PIForm.prototype.field = function (key) {
      const field = this.spec(key);
      const staged = this.staged.get(key);
      if (staged === undefined) {
        const value = this.sectionValue(key);
        if (field.type === "list") {
          return {
            stagedList: value === undefined || value === null ? [] : value,
            overridden: this.stored(key),
            invalid: false
          };
        }
        return {
          stagedBool: field.type === "bool" ? value === true : undefined,
          overridden: this.stored(key),
          invalid: false
        };
      }
      if (staged.cleared) {
        if (field.type === "list") return { stagedList: [], overridden: true, invalid: false };
        return { stagedBool: false, overridden: true, invalid: false };
      }
      if (field.type === "list") {
        return {
          stagedList: Array.isArray(staged.value) ? staged.value : [],
          overridden: true,
          invalid: staged.invalid === true
        };
      }
      return {
        stagedBool: field.type === "bool" ? staged.value === true : undefined,
        overridden: true,
        invalid: staged.invalid === true
      };
    };
    PIForm.prototype.plan = function () {
      const plan = [];
      this.staged.forEach((staged, key) => {
        const field = this.spec(key);
        if (staged.cleared) {
          if (this.stored(key)) plan.push({ key, run: () => this.scope.unset(key).then(() => !this.stored(key)) });
          return;
        }
        if (staged.invalid) {
          plan.push({ key, run: undefined });
          return;
        }
        if (field.type === "bool") {
          if (this.sectionValue(key) === staged.value) return;
          plan.push({ key, run: () => this.scope.set(key, staged.value).then(() => {
            const user = this.userLayer();
            return user !== undefined && user !== null && user[key] === staged.value;
          }) });
          return;
        }
        if (field.type === "list") {
          const section = this.sectionValue(key);
          const a = section === undefined || section === null ? [] : section;
          if (JSON.stringify(a) === JSON.stringify(staged.value)) return;
          plan.push({ key, run: () => this.scope.set(key, staged.value).then(() => {
            const user = this.userLayer();
            return user !== undefined && user !== null && JSON.stringify((user[key] === undefined ? [] : user[key])) === JSON.stringify(staged.value);
          }) });
          return;
        }
        const section = this.sectionValue(key);
        if (section === undefined || section === null) {
          if (staged.value === "") return;
        } else if (String(section) === String(staged.value)) return;
        plan.push({ key, run: () => this.scope.set(key, staged.value).then(() => {
          const user = this.userLayer();
          return user !== undefined && user !== null && user[key] === staged.value;
        }) });
      });
      return plan;
    };
    PIForm.prototype.shell = function () {
      const snapshot = this.snapshotOf();
      const plan = this.plan();
      return {
        available: snapshot.status === "ready",
        writable: snapshot.writable === true,
        dirty: plan.length > 0,
        invalid: plan.some((item) => item.run === undefined),
        saving: this.saving,
        failed: this.failed
      };
    };
    PIForm.prototype.projection = function () {
      const shell = this.shell();
      const result = { shell };
      FIELDS.forEach((f) => { result[f.key] = this.field(f.key); });
      const enabledField = this.field("enabled");
      const promptsField = this.field("prompts");
      var enabledNow = false;
      if (enabledField.stagedBool !== undefined) enabledNow = enabledField.stagedBool === true;
      else enabledNow = this.sectionValue("enabled") === true;
      result.status = {
        enabled: enabledNow,
        promptCount: (promptsField.stagedList || []).length
      };
      return result;
    };
    PIForm.prototype.actions = function () {
      const self = this;
      return {
        edit: (key, raw) => {
          self.staged.set(key, parseFieldValue(self.spec(key), raw));
          self.failed = false;
          self.publish();
        },
        toggle: (key, checked) => {
          self.staged.set(key, { value: checked === true });
          self.failed = false;
          self.publish();
        },
        resetField: (key) => {
          self.staged.delete(key);
          self.failed = false;
          self.publish();
        },
        save: async () => {
          const plan = self.plan();
          const runs = [];
          plan.forEach((item) => { if (item.run !== undefined) runs.push(item.run); });
          if (plan.length === 0) {
            if (self.saving) return;
            self.staged.clear();
            self.failed = false;
            self.publish();
            return;
          }
          if (self.saving || runs.length !== plan.length) return;
          self.saving = true;
          self.failed = false;
          self.publish();
          const planned = [];
          plan.forEach((item) => {
            const ref = self.staged.get(item.key);
            if (ref !== undefined) planned.push([item.key, ref]);
          });
          let landed = true;
          for (let i = 0; i < runs.length; i += 1) {
            const okRun = await runs[i]();
            if (!okRun) landed = false;
          }
          if (landed) {
            for (const [key, ref] of planned) {
              if (self.staged.get(key) === ref) self.staged.delete(key);
            }
          }
          self.saving = false;
          self.failed = !landed;
          self.publish();
        },
        discard: () => {
          if (self.staged.size === 0 && !self.failed) return;
          self.staged.clear();
          self.failed = false;
          self.publish();
        }
      };
    };

    // ---- 翻译表（zh 全量；en 继承中文 + 少量覆盖）----
    const zh = {
      "card.title": "上下文注入（通用提示词）",
      "card.description": "每轮对话向模型上下文注入你配置的提示词（每条一行「上下文注入 xxx」提醒）；可按需开关于启用、添加/删除/修改提示词。",
      "card.statusOn": "启用",
      "card.statusOff": "停用",
      "card.promptCount": "启用中 {n} 条",
      "unsaved": "未保存",
      "expand": "展开",
      "collapse": "收起",
      "save": "保存",
      "saving": "保存中…",
      "discard": "放弃",
      "saveFailed": "保存未生效，请检查输入",
      "readOnly": "当前会话只读",
      "overridden": "已覆盖",
      "reset": "重置",
      "invalid": "输入无效",
      "group.general": "基本设置",
      "field.enabled": "启用注入",
      "hint.enabled": "总开关。关闭后每轮不再注入任何提示词。",
      "field.skipTrivial": "琐碎输入跳过",
      "hint.skipTrivial": "纯问候/确认/继续（好的、嗯、收到、继续…）不注入提醒，避免打扰；有实义内容（如「继续帮我看看那个报错」）照常注入。",
      "group.prompts": "注入的提示词",
      "field.prompts": "提示词列表",
      "hint.prompts": "每条启用中的提示词，每一轮对话都会以「上下文注入 <标题>」形式注入一条。标题用于识别，正文是注入内容。",
      "prompt.enabled": "启用此行",
      "prompt.add": "＋ 添加提示词",
      "prompt.delete": "删除",
      "prompt.titlePlaceholder": "标题（如：图谱·Wiki 提醒）",
      "prompt.textPlaceholder": "注入正文——提醒模型该轮按需执行什么（写清楚判断条件：什么情况要查、什么情况跳过）…",
      "prompt.emptyBodyWarn": "正文为空，此行保存后不会注入。"
    };
    const en = Object.assign({}, zh, {
      "card.title": "Context injection (generic prompts)",
      "card.description": "Inject your configured prompts into the model context every round (one 「上下文注入 xxx」 notice line each); toggle on/off, add/remove/edit prompts.",
      "card.statusOn": "Enabled",
      "card.statusOff": "Disabled",
      "card.promptCount": "{n} prompts enabled",
      "unsaved": "Unsaved",
      "expand": "Expand",
      "collapse": "Collapse",
      "save": "Save",
      "saving": "Saving…",
      "discard": "Discard",
      "saveFailed": "Save did not land; check your input",
      "readOnly": "Read-only in this session",
      "overridden": "Overridden",
      "reset": "Reset",
      "invalid": "Invalid input",
      "group.general": "General",
      "field.enabled": "Enable injection",
      "hint.enabled": "Master switch. When off, no prompts are injected.",
      "field.skipTrivial": "Skip trivial rounds",
      "hint.skipTrivial": "Greetings/confirmations/continuations (好的、嗯、收到、继续…) skip injection; substantive input (e.g. 继续帮我看看那个报错) still gets it.",
      "group.prompts": "Prompts to inject",
      "field.prompts": "Prompt list",
      "hint.prompts": "Each enabled prompt is injected every round as one 「上下文注入 <title>」 notice. Title is for recognition; body is the injected text.",
      "prompt.enabled": "Enable this row",
      "prompt.add": "＋ Add prompt",
      "prompt.delete": "Delete",
      "prompt.titlePlaceholder": "Title (e.g. 图谱·Wiki 提醒)",
      "prompt.textPlaceholder": "Body — tell the model what to do per-round (write the judgment: when to check, when to skip)…",
      "prompt.emptyBodyWarn": "Empty body — this row will not be injected."
    });

    const GROUPS = [
      { titleKey: "group.general", keys: ["enabled", "skipTrivial"] },
      { titleKey: "group.prompts", keys: ["prompts"] }
    ];

    // ---- 视图组件 ----
    function FieldRow(props) {
      const t = props.t;
      const head = jsxs("div", { className: "PInj_head", children: [
        jsx("label", { className: "PInj_label", htmlFor: props.id, children: t(props.labelKey) }),
        jsxs("div", { className: "PInj_badges", children: [
          props.overridden ? jsx("span", { className: "PInj_badge", children: t("overridden") }) : null,
          props.overridden
            ? jsx("button", { className: "PInj_reset", onClick: () => props.resetField(props.fieldName), children: "↺ " + t("reset") })
            : null
        ] })
      ] });
      const control = props.type === "bool"
        ? jsx("input", { type: "checkbox", className: "PInj_check", id: props.id, checked: props.value === true, onChange: (e) => props.toggle(props.fieldName, e.target.checked), disabled: !props.writable })
        : null;
      return jsxs("div", { className: "PInj_field", children: [
        head,
        control,
        jsx("p", { className: "PInj_hint", children: t(props.hintKey) })
      ] });
    }

    function PromptsEditor(props) {
      const t = props.t;
      const list = props.list || [];
      const cycle = (i, patch) => {
        const next = list.map((p, j) => (j === i ? Object.assign({}, p, patch) : p));
        props.edit("prompts", next);
      };
      const remove = (i) => {
        const next = list.filter((p, j) => j !== i);
        props.edit("prompts", next);
      };
      const append = () => {
        const id = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : ("pi-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
        const next = list.concat([{ id, title: "", text: "", enabled: true }]);
        props.edit("prompts", next);
      };
      const rows = list.map((p, i) => {
        const key = String(p.id || ("row-" + i));
        return jsxs("div", { className: "PInj_row", key: key, children: [
          jsxs("div", { className: "PInj_rowHead", children: [
            jsx("input", { className: "PInj_input", value: p.title || "", placeholder: t("prompt.titlePlaceholder"), onChange: (e) => cycle(i, { title: e.target.value }) }),
            jsxs("label", { className: "PInj_rowToggle", children: [
              jsx("input", { type: "checkbox", className: "PInj_check", checked: p.enabled !== false, onChange: (e) => cycle(i, { enabled: e.target.checked }) }),
              t("prompt.enabled")
            ] }),
            jsx("button", { className: "PInj_del", onClick: () => remove(i), children: t("prompt.delete") })
          ] }),
          jsx("textarea", { className: "PInj_text", value: p.text || "", rows: 4, placeholder: t("prompt.textPlaceholder"), onChange: (e) => cycle(i, { text: e.target.value }) }),
          !(p.text || "") ? jsx("p", { className: "PInj_rowWarn", children: t("prompt.emptyBodyWarn") }) : null
        ] });
      });
      return jsxs("div", { className: "PInj_prompts", children: [
        rows,
        jsx("button", { className: "PInj_add", type: "button", onClick: append, children: t("prompt.add") })
      ] });
    }

    function PromptInjectorCard(props) {
      const t = props.t;
      const state = props.usePromptInjector((s) => s);
      const shell = state.shell;
      const [open, setOpen] = useState(false);
      const blocked = !shell.dirty || shell.invalid || shell.saving;
      const body = open ? jsxs("div", { className: "PInj_body", children: [
        !shell.writable ? jsx("p", { className: "PInj_readOnly", children: t("readOnly") }) : null,
        GROUPS.map((group) => jsxs("div", { className: "PInj_group", children: [
          jsx("p", { className: "PInj_groupTitle", children: t(group.titleKey) }),
          group.keys.map((key) => {
            const field = FIELDS.find((f) => f.key === key);
            const fv = state[key];
            if (field.type === "list") {
              return jsxs("div", { className: "PInj_field", children: [
                jsxs("div", { className: "PInj_head", children: [
                  jsx("label", { className: "PInj_label", children: t("field.prompts") }),
                  jsxs("div", { className: "PInj_badges", children: [
                    fv.overridden ? jsx("span", { className: "PInj_badge", children: t("overridden") }) : null,
                    fv.overridden
                      ? jsx("button", { className: "PInj_reset", onClick: () => props.resetField("prompts"), children: "↺ " + t("reset") })
                      : null
                  ] })
                ] }),
                jsx(PromptsEditor, { t: t, edit: props.edit, list: fv.stagedList }),
                jsx("p", { className: "PInj_hint", children: t("hint.prompts") })
              ] });
            }
            return jsx(FieldRow, Object.assign({}, props, {
              key: key,
              id: key,
              fieldName: key,
              labelKey: "field." + key,
              hintKey: "hint." + key,
              type: field.type,
              value: fv.stagedBool,
              overridden: fv.overridden
            }));
          })
        ] })),
        jsxs("div", { className: "PInj_footer", children: [
          shell.failed ? jsx("p", { className: "PInj_failed", children: t("saveFailed") }) : null,
          jsx("button", { className: "PInj_discard", type: "button", disabled: (!shell.dirty && !shell.failed) || shell.saving, onClick: () => props.discard(), children: t("discard") }),
          jsx("button", { className: "PInj_save", type: "button", disabled: blocked, onClick: () => props.save(), children: shell.saving ? t("saving") : t("save") })
        ] })
      ] }) : null;
      return jsxs("li", { className: shell.dirty ? "PInj_card PInj_cardOpen" : "PInj_card", children: [
        jsx("button", { className: "PInj_header", type: "button", onClick: () => setOpen(!open), children: [
          jsxs("div", { className: "PInj_headText", children: [
            jsx("span", { className: "PInj_name", children: t("card.title") }),
            jsx("span", { className: "PInj_description", children: t("card.description") })
          ] }),
          state.status.enabled
            ? jsx("span", { className: "PInj_pending", children: t("card.statusOn") + " · " + t("card.promptCount", { n: state.status.promptCount }) })
            : jsx("span", { className: "PInj_pending", children: t("card.statusOff") }),
          shell.dirty ? jsx("span", { className: "PInj_pending", children: t("unsaved") }) : null,
          jsx("span", { className: open ? "PInj_chevron PInj_chevronOpen" : "PInj_chevron", children: "▾" })
        ] }),
        body
      ] });
    }

    // ---- 样式（官方 plugin-card 风格，独立类名前缀防冲突）----
    const css = ".PInj_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.PInj_card:hover{border-color:var(--dsw-alias-label-dimmed)}.PInj_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.PInj_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.PInj_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.PInj_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.PInj_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.PInj_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.PInj_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.PInj_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.PInj_chevronOpen{transform:rotate(180deg)}.PInj_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.PInj_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.PInj_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.PInj_failed{min-width:0;color:var(--dsw-alias-label-error);text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0;font-size:12px;line-height:1.5;overflow:hidden}.PInj_discard,.PInj_save,.PInj_add,.PInj_del{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.PInj_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.PInj_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.PInj_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.PInj_discard:disabled,.PInj_save:disabled{opacity:.4;cursor:default}.PInj_add{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2);margin-top:8px}.PInj_del{background:0 0;color:var(--dsw-alias-label-error);border-color:var(--dsw-alias-border-l2);padding:2px 10px;font-size:12px}.PInj_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.PInj_field+.PInj_field{border-top:1px solid var(--dsw-alias-border-l2)}.PInj_group{padding-top:8px}.PInj_groupTitle{color:var(--dsw-alias-label-secondary);margin:10px 0 2px;font-size:12px;font-weight:600;line-height:1.5}.PInj_head{align-items:center;gap:8px;display:flex}.PInj_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.PInj_badges{align-items:center;gap:8px;display:inline-flex}.PInj_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.PInj_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.PInj_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}.PInj_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.PInj_text{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box;resize:vertical}.PInj_text:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.PInj_row{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;gap:8px;padding:10px 12px;flex-direction:column;display:flex;margin-bottom:8px}.PInj_rowHead{align-items:center;gap:10px;display:flex}.PInj_rowToggle{white-space:nowrap;color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;display:inline-flex;font-size:12px}.PInj_check{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}.PInj_rowWarn{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.PInj_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.PInj_groupTitle+.PInj_row{border-top:1px solid var(--dsw-alias-border-l2)}@media (prefers-reduced-motion:reduce){.PInj_card,.PInj_header,.PInj_chevron,.PInj_discard,.PInj_save{transition:none}}";
    const tagId = "dsh-prompt-injector/settings.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-prompt-injector";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const injectServices = ["slots", "locale", "settingsScope"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-prompt-injector: dictionaries");
      const scope = ctx.settingsScope.bind({ namespace: NS });
      const form = new PIForm(scope);
      ctx.effect(() => scope.subscribe(() => form.publish()), "dsh-prompt-injector: scope-follow");
      ctx.slots.inject("settings.plugin.item", function* () {
        yield ctx.slots.register({
          name: "settings.plugin.item",
          key: NS,
          locale: NS,
          inject: () => ({
            hooks: { promptInjector: form.store },
            ...form.actions()
          })
        }, PromptInjectorCard);
      });
    }

    exports.apply = apply;
    exports.inject = injectServices;
    return module.exports;
  }
});