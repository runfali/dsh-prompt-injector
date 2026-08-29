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
  set: async (key, value) => {
    scopeState.user[key] = value
    scopeState.value = Object.assign({}, scopeState.value, { [key]: value })
    scopeListeners.forEach((fn) => fn())
    return true
  },
  unset: async (key) => {
    delete scopeState.user[key]
    scopeState.value = Object.assign({}, scopeState.value)
    delete scopeState.value[key]
    scopeListeners.forEach((fn) => fn())
    return true
  }
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
for (const key of ['card.title', 'card.promptCount', 'field.enabled', 'hint.enabled', 'field.skipTrivial', 'hint.skipTrivial', 'field.prompts', 'hint.prompts', 'prompt.add', 'prompt.delete', 'prompt.titlePlaceholder', 'prompt.textPlaceholder', 'prompt.emptyBodyWarn', 'prompt.triggerLabel', 'prompt.triggerEveryTurn', 'prompt.triggerPostCompaction', 'group.general', 'group.prompts']) {
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
for (const needle of ['上下文注入（通用提示词）', '启用注入', '琐碎输入跳过', '提示词列表', '添加提示词', '图谱·Wiki 提醒', '删除', '保存', '触发', '每轮注入']) {
  assert.ok(joined.includes(needle), '渲染文案应含: ' + needle)
}
ok('卡片渲染包含全部控件文案（含提示词行与添加按钮）')

console.log('== form 保存链路（2026-08-26 第二轮审计固化）==')
const snap = () => payload.hooks.promptInjector.getSnapshot()
assert.equal(snap().shell.dirty, false, '初始不脏')
payload.edit('prompts', snap().prompts.stagedList.concat([{ id: 'x1', title: '新条', text: '内容', enabled: true }]))
assert.equal(snap().shell.dirty, true, '添加后脏')
await payload.save()
assert.equal(scopeState.user.prompts.length, 2, '保存落盘 user 层')
assert.equal(snap().shell.dirty, false, '保存后不脏')
payload.edit('prompts', [])
await payload.save()
assert.deepEqual(scopeState.user.prompts, [], '删光保存为空数组（host normPrompts 语义配套）')
ok('添加→保存→删光→空数组全链路正确')

console.log('== 只读态禁用 ==')
const savedWritable = scopeState.writable
scopeState.writable = false
scopeListeners.forEach((fn) => fn())
const readOnlyTree = jsxStub(CardWithHooks, { t: (k) => zh[k] || k })
let disabledCount = 0
function countDisabled(node) {
  if (node === null || node === undefined) return
  if (node.props && node.props.disabled === true) disabledCount += 1
  if (typeof node.type === 'function') { countDisabled(node.type(node.props)); return }
  for (const child of node.children || []) countDisabled(child)
}
countDisabled(readOnlyTree)
assert.ok(disabledCount >= 5, '只读态下编辑控件应禁用（含添加/删除/输入）')
scopeState.writable = savedWritable
scopeListeners.forEach((fn) => fn())
ok('只读态控件全部禁用 (' + disabledCount + ' 处)')

console.log('== discard / 保存失败路径（2026-08-26 第三轮审计固化）==')
payload.edit('prompts', snap().prompts.stagedList.concat([{ id: 'y1', title: '待放弃', text: 'x', enabled: true }]))
assert.equal(snap().shell.dirty, true, '编辑后脏')
payload.discard()
assert.equal(snap().shell.dirty, false, 'discard 后不脏')
assert.equal(snap().prompts.stagedList.length, 0, 'discard 后 staged 清空（当前 user 层为空数组）')
// 保存失败路径：让 scope.set 返回 false → failed 显示
const originalSet = scopeStub.set
scopeStub.set = async () => false
payload.edit('enabled', false)
await payload.save()
assert.equal(snap().shell.failed, true, '保存失败标记 failed')
assert.equal(snap().shell.dirty, true, '失败后暂存保留（可重试/放弃）')
scopeStub.set = originalSet
payload.discard()
ok('discard 与保存失败路径正确')

console.log('== 交互回归（2026-08-27 真机缺陷修复）==')
// 0. 恢复一行数据（前序「删光保存」测试把 value.prompts 置空）
scopeState.value = Object.assign({}, scopeState.value, { prompts: [{ id: 'g1', title: '图谱·Wiki 提醒', text: '正文', enabled: true }] })
scopeListeners.forEach((fn) => fn())
// 1. 添加按钮：新空行必须保留（parseFieldValue 不过滤空行）
const before = snap().prompts.stagedList.length
payload.edit('prompts', snap().prompts.stagedList.concat([{ id: 'new1', title: '', text: '', enabled: true }]))
assert.equal(snap().prompts.stagedList.length, before + 1, '添加空行后 stagedList 应 +1（空行保留等待填写）')
assert.equal(snap().prompts.stagedList[before].text, '', '新行正文为空')
payload.discard()
// 2. FieldRow checkbox：可写态不禁用、只读态禁用（props.writable 必须真实传递）
function collectCheckboxDisabled(node, out) {
  if (node === null || node === undefined) return
  if (node.props && node.props.type === 'checkbox') out.push(node.props.disabled === true)
  if (typeof node.type === 'function') { collectCheckboxDisabled(node.type(node.props), out); return }
  for (const child of node.children || []) collectCheckboxDisabled(child, out)
}
const writableFlags = []
collectCheckboxDisabled(jsxStub(CardWithHooks, { t: (k) => zh[k] || k }), writableFlags)
console.log('CHECKBOX COUNT:', writableFlags.length, JSON.stringify(writableFlags))
assert.ok(writableFlags.length >= 3, '渲染树应有 ≥3 个 checkbox（2 个开关 + 行开关）')
assert.ok(writableFlags.every((d) => d === false), '可写态下所有 checkbox 不应禁用（回归：FieldRow 曾缺 writable prop 恒禁用）')
const savedWritable2 = scopeState.writable
scopeState.writable = false
scopeListeners.forEach((fn) => fn())
const roFlags = []
collectCheckboxDisabled(jsxStub(CardWithHooks, { t: (k) => zh[k] || k }), roFlags)
assert.ok(roFlags.every((d) => d === true), '只读态下所有 checkbox 应禁用')
scopeState.writable = savedWritable2
scopeListeners.forEach((fn) => fn())
ok('checkbox disabled 绑定与添加空行保留正确')

console.log('== trigger 下拉与保存链路（C5，memorax 吸收 2026-08-29）==')
// 1. 行编辑器渲染 trigger 下拉：select 控件 + 两个选项
function collectSelects(node, out) {
  if (node === null || node === undefined) return
  if (typeof node.type === 'function') { collectSelects(node.type(node.props), out); return }
  if (node.type === 'select') out.push(node.props)
  for (const child of node.children || []) collectSelects(child, out)
}
const selects = []
collectSelects(jsxStub(CardWithHooks, { t: (k) => zh[k] || k }), selects)
assert.ok(selects.length >= 1, '提示词行应渲染 trigger select')
assert.equal(selects[0].value, 'everyTurn', '无 trigger 旧行显示 everyTurn（零迁移）')
assert.equal(selects[0].disabled, false, '可写态 select 不禁用')
ok('trigger 下拉渲染：旧行缺省显示 everyTurn')
// 2. edit→save 保留 trigger；parseFieldValue 归一化非法值
payload.edit('prompts', [
  { id: 'g1', title: '图谱·Wiki 提醒', text: '正文', enabled: true, trigger: 'postCompaction' },
  { id: 'g2', title: '无 trigger', text: 'x', enabled: true },
  { id: 'g3', title: '非法 trigger', text: 'y', enabled: true, trigger: 'bogus' }
])
assert.equal(snap().prompts.stagedList[0].trigger, 'postCompaction', 'staged 保留 postCompaction')
assert.equal(snap().prompts.stagedList[1].trigger, 'everyTurn', '缺省归一化 everyTurn')
assert.equal(snap().prompts.stagedList[2].trigger, 'everyTurn', '非法值归一化 everyTurn')
await payload.save()
assert.equal(scopeState.user.prompts[0].trigger, 'postCompaction', '落盘保留 postCompaction')
assert.equal(scopeState.user.prompts[2].trigger, 'everyTurn', '落盘归一化非法值')
ok('trigger 三态（保留/缺省/非法归一）保存链路正确')
// 3. 只读态 select 禁用
scopeState.writable = false
scopeListeners.forEach((fn) => fn())
const roSelects = []
collectSelects(jsxStub(CardWithHooks, { t: (k) => zh[k] || k }), roSelects)
assert.ok(roSelects.length >= 1 && roSelects.every((props) => props.disabled === true), '只读态 select 应禁用')
scopeState.writable = savedWritable
scopeListeners.forEach((fn) => fn())
ok('只读态 trigger 下拉禁用')

console.log('\n全部通过: ' + PASS.length + ' 项')