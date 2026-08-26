/**
 * dsh-prompt-injector client bundle 结构加载测试。
 *
 * 运行：node test/client-smoke.mjs
 * 构造最小 window.__ModuleLoader__ + require stub，加载 lib/client.js，
 * 执行 apply，验证：
 * 1. bundle id 与包名一致（dsh-client-modules 契约）
 * 2. locale 词典注册（zh/en 键集合一致、覆盖全部 label/hint/UI 文案）
 * 3. settingsScope 绑定 namespace=prompt-injector
 * 4. settings.plugin.item 槽位注册：key/locale 正确，inject() 提供 hooks+actions
 * 5. 卡片渲染：展开态包含「添加提示词」按钮、布尔字段、提示词行
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PASS = []
const ok = (label) => { PASS.push(label); console.log('  ✓ ' + label) }

function makeElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat().filter((c) => c !== null && c !== undefined) }
}
let renderDepth = 0
function renderTree(node) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return
  if (typeof node.type === 'function') {
    renderDepth += 1
    if (renderDepth > 50) throw new Error('component tree too deep — likely infinite recursion')
    const children = node.type(node.props)
    renderTree(children)
    renderDepth -= 1
    return
  }
  for (const child of node.children || []) renderTree(child)
}
let elementCount = 0
const reactStub = {
  useState: (init) => [typeof init === 'boolean' ? true : (typeof init === 'function' ? init() : init), () => {}],
  useSyncExternalStore: (subscribe, getSnapshot) => {
    subscribe(() => {})
    return getSnapshot()
  }
}
const jsxStub = (type, props) => {
  elementCount += 1
  const pc = props && props.children
  const children = pc === undefined || pc === null ? [] : (Array.isArray(pc) ? pc : [pc])
  return makeElement(type, props, ...children)
}
const jsxsStub = (type, props) => {
  elementCount += 1
  const pc = props && props.children
  const ch = pc === undefined || pc === null ? [] : (Array.isArray(pc) ? pc : [pc])
  return makeElement(type, props, ...ch)
}

const primitivesStub = new Proxy({}, { get: (target, name) => function Icon() {} })

let bundleFactory = null
let bundleId = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      bundleId = id
      bundleFactory = factory
    }
  }
}

const requireStub = (specifier) => {
  if (specifier === 'react') return reactStub
  if (specifier === 'react/jsx-runtime') return { jsx: jsxStub, jsxs: jsxsStub }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
  throw new Error('unexpected require: ' + specifier)
}

new Function('code', 'return eval(code)')(
  readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
)

console.log('== bundle 加载 ==')
assert.equal(bundleId, 'dsh-prompt-injector', 'bundle id 必须等于包名'); ok('bundle id = dsh-prompt-injector')
assert.ok(bundleFactory, 'factory 存在')

const exportsRef = bundleFactory(requireStub)
assert.equal(exportsRef.inject.length, 3, 'inject 服务数'); ok('exports.inject = [slots, locale, settingsScope]')

// ---- 桩环境：settingsScope + locale + slots ----
const localeDicts = {}
let boundNamespace = null
const scopeListeners = new Set()
const scopeState = {
  status: 'ready',
  writable: true,
  value: { enabled: true, skipTrivial: true, prompts: [{ id: 'g1', title: '图谱·Wiki 提醒', text: '正文', enabled: true }] },
  user: {}
}
const scopeStub = {
  bind({ namespace }) { boundNamespace = namespace; return scopeStub },
  getSnapshot: () => scopeState,
  subscribe(fn) { scopeListeners.add(fn); return () => scopeListeners.delete(fn); },
  set: async (key, value) => { scopeState.user[key] = value; return true },
  unset: async (key) => { delete scopeState.user[key]; return true }
}
let slotEntry = null
const slotsStub = {
  inject(slot, generator) {
    const iterator = generator()
    for (const reg of iterator) slotEntry = { slot, reg }
  },
  register(def, component) { return { def, component } }
}
const ctxStub = {
  effect(fn) { return fn() },
  locale: { register(ns, dict) { localeDicts[ns] = dict } },
  settingsScope: scopeStub,
  slots: slotsStub
}

exportsRef.apply(ctxStub)

console.log('== locale ==')
const zh = localeDicts['prompt-injector'].zh
const en = localeDicts['prompt-injector'].en
assert.ok(zh, 'zh 词典存在')
assert.ok(en, 'en 词典存在')
for (const key of Object.keys(zh)) {
  assert.ok(Object.prototype.hasOwnProperty.call(en, key), 'en 应含 zh 全部键: ' + key)
}
ok('zh/en 键集合一致 (' + Object.keys(zh).length + ' 键)')
for (const key of ['card.title', 'card.promptCount', 'field.enabled', 'hint.enabled', 'field.skipTrivial', 'hint.skipTrivial', 'field.prompts', 'hint.prompts', 'prompt.add', 'prompt.delete', 'prompt.titlePlaceholder', 'prompt.textPlaceholder', 'prompt.emptyBodyWarn', 'group.general', 'group.prompts']) {
  assert.ok(zh[key], 'zh 翻译键缺失: ' + key)
}
ok('关键翻译键齐全')

console.log('== settingsScope ==')
assert.equal(boundNamespace, 'prompt-injector', 'namespace 必须 = prompt-injector')
ok('namespace = prompt-injector')

console.log('== slot ==')
assert.equal(slotEntry.slot, 'settings.plugin.item', 'slot 类型')
const injected = slotEntry.reg
assert.equal(injected.def.name, 'settings.plugin.item')
assert.equal(injected.def.key, 'prompt-injector')
assert.equal(injected.def.locale, 'prompt-injector')
const payload = injected.def.inject()
assert.ok(payload.hooks && payload.hooks.promptInjector, 'hooks.promptInjector 提供')
assert.equal(typeof payload.edit, 'function')
assert.equal(typeof payload.save, 'function')
assert.equal(typeof payload.discard, 'function')
ok('slot 注册契约完整 (hooks.usePromptInjector + actions)')

console.log('== 卡片渲染 ==')
const Card = injected.component
const CardWithHooks = (props) => Card(Object.assign({}, props, {
  usePromptInjector: payload.hooks.promptInjector.getSnapshot
}))
renderTree(jsxStub(CardWithHooks, { t: (k) => zh[k] || k }))
// 收集渲染树文案
const texts = []
function collectText(node) {
  if (node === null || node === undefined) return
  if (typeof node === 'string') { texts.push(node); return }
  if (node.props && typeof node.props.value === 'string' && node.props.value) texts.push(node.props.value)
  if (typeof node.type === 'function') { collectText(node.type(node.props)); return }
  for (const child of node.children || []) collectText(child)
}
collectText(jsxStub(CardWithHooks, { t: (k) => zh[k] || k }), 0)
const joined = texts.join(" ")
for (const needle of ['上下文注入（通用提示词）', '启用注入', '琐碎输入跳过', '提示词列表', '添加提示词', '图谱·Wiki 提醒', '删除', '保存']) {
  assert.ok(joined.includes(needle), '渲染文案应含: ' + needle)
}
ok('卡片渲染包含全部控件文案（含提示词行与添加按钮）')

console.log('\n全部通过: ' + PASS.length + ' 项')