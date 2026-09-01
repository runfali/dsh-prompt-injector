/**
 * dsh-prompt-injector host logic tests (node --test)
 * 覆盖：默认提示词要素、normPrompts 归一化兜底、makePromptMessage 形态
 * （form:'notice' + summary 纯标题，UI 自动加前缀）、shouldInject 决策。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PROMPTS, makePromptMessage, shouldInject, isTrivialPrompt, normPrompts, selectPrompts } from '../src/logic.js'

test('默认提示词：空列表（2026-08-29 开源决策——只留机制，不预设内容）', () => {
  assert.deepEqual(DEFAULT_PROMPTS, [])
  // 未配置/非法 → 空（不注入）；用户自填才生效
  assert.deepEqual(normPrompts(undefined), [])
  assert.deepEqual(normPrompts('bad'), [])
  // 空默认下整条链路不产出提醒
  const sel = selectPrompts(normPrompts(undefined), {
    freshUser: { source: { kind: 'user' }, content: [{ type: 'text', text: '干活' }] },
    skipTrivial: true, generation: 3, applied: () => 0
  })
  assert.deepEqual(sel.prompts, [])
})

test('normPrompts：trigger 归一化（缺省/非法→everyTurn；postCompaction 保留）', () => {
  const out = normPrompts([
    { id: 'a', text: 'x' },
    { id: 'b', text: 'y', trigger: 'postCompaction' },
    { id: 'c', text: 'z', trigger: 'bogus' }
  ])
  assert.equal(out[0].trigger, 'everyTurn')
  assert.equal(out[1].trigger, 'postCompaction')
  assert.equal(out[2].trigger, 'everyTurn')
})

test('selectPrompts：everyTurn 行语义不变（freshUser+非琐碎），postCompaction 行按代际', () => {
  const every = { id: 'e', title: 'E', text: 'x', enabled: true, trigger: 'everyTurn' }
  const post = { id: 'p', title: 'P', text: 'y', enabled: true, trigger: 'postCompaction' }
  const real = { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改代码' }] }
  const trivial = { source: { kind: 'user' }, content: [{ type: 'text', text: '好的' }] }
  const applied = new Map()
  const run = (freshUser, generation, skipTrivial = true) =>
    selectPrompts([every, post], { freshUser, skipTrivial, generation, applied: (id) => applied.get(id) || 0 })
  // 代际 0：postCompaction 不注入
  let sel = run(real, 0)
  assert.deepEqual(sel.prompts.map((x) => x.id), ['e'])
  assert.deepEqual(sel.mark, [])
  // 代际推进到 1：注入一次并 mark
  sel = run(real, 1)
  assert.deepEqual(sel.prompts.map((x) => x.id), ['e', 'p'])
  assert.deepEqual(sel.mark, ['p'])
  applied.set('p', 1)
  // 同代不再注入
  sel = run(real, 1)
  assert.deepEqual(sel.prompts.map((x) => x.id), ['e'])
  assert.deepEqual(sel.mark, [])
  // 新代再注入一次
  sel = run(real, 2)
  assert.deepEqual(sel.prompts.map((x) => x.id), ['e', 'p'])
  applied.set('p', 2)
  // 琐碎轮：everyTurn 被 skipTrivial 拦截，postCompaction 不拦截（一次性系统告知）
  sel = run(trivial, 3)
  assert.deepEqual(sel.prompts.map((x) => x.id), ['p'])
  assert.deepEqual(sel.mark, ['p'])
  applied.set('p', 3) // 模拟宿主按 mark 记账
  // skipTrivial=false 时琐碎轮照常 everyTurn（同代 p 不再）
  sel = run(trivial, 3, false)
  assert.deepEqual(sel.prompts.map((x) => x.id), ['e'])
  // 无 freshUser：全不注入
  sel = run(undefined, 9)
  assert.deepEqual(sel.prompts, [])
  // 停用/空正文行被过滤
  sel = selectPrompts([{ id: 'off', text: 'x', enabled: false, trigger: 'postCompaction' }, { id: 'empty', text: '', enabled: true }], { freshUser: real, skipTrivial: true, generation: 5, applied: () => 0 })
  assert.deepEqual(sel.prompts, [])
})

test('normPrompts：非法输入兜底（非数组→默认；undefined→默认）', () => {
  assert.equal(normPrompts(undefined).length, DEFAULT_PROMPTS.length)
  assert.equal(normPrompts('bad').length, DEFAULT_PROMPTS.length)
})

test('normPrompts：显式空数组保持为空（用户删光=不再注入，2026-08-26 审计 P1 回归）', () => {
  assert.deepEqual(normPrompts([]), [])
  assert.deepEqual(normPrompts([null, 42, 'x']), [])
})

test('normPrompts：过滤非法条目、id 自动补、enabled 默认 true', () => {
  const out = normPrompts([
    null,
    { title: '标题A', text: '正文A' },
    { id: 'x', title: '标题B', text: '正文B', enabled: false },
    42
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].id, 'p1')
  assert.equal(out[0].enabled, true)
  assert.equal(out[1].enabled, false)
})

test('normPrompts：重复 id 去重（2026-09-02 审计 P2——行 key 冲突 + postCompaction 记账共享）', () => {
  // 用户手写 yaml 两条同 id：应产出唯一 id（第二条追加序号），不破坏
  // client 行 key 与 postCompaction 代际记账的「一 id 一账」语义。
  const out = normPrompts([
    { id: 'a', title: 'A1', text: 'x1', trigger: 'postCompaction' },
    { id: 'a', title: 'A2', text: 'x2', trigger: 'postCompaction' },
    { id: 'a', title: 'A3', text: 'x3', trigger: 'postCompaction' },
    { id: 'b', title: 'B', text: 'y' }
  ])
  assert.equal(out.length, 4)
  const ids = out.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'id 全部唯一')
  assert.deepEqual(ids, ['a', 'a-2', 'a-3', 'b'], '重复 id 追加序号且不误伤后续')
  // 不重复的合法 id 原样保留（零迁移）
  assert.equal(out[0].title, 'A1')
  assert.equal(out[3].title, 'B')
  // 序号碰撞链：a、a-2 已存在时第三条应取 a-3 而非撞 a-2
  const chained = normPrompts([
    { id: 'c', title: 'C1' },
    { id: 'c', title: 'C2' },
    { id: 'c-2', title: 'C3' },
    { id: 'c', title: 'C4' }
  ])
  assert.deepEqual(chained.map((p) => p.id), ['c', 'c-2', 'c-2-2', 'c-3'], '序号碰撞链正确推进')
})

test('makePromptMessage：notice 形态 + summary 纯标题（UI 自动加「上下文注入」前缀，2026-08-27 反馈）', () => {
  const m = makePromptMessage({ id: 'a', title: '图谱·Wiki 提醒', text: '正文', enabled: true })
  assert.equal(m.role, 'user')
  assert.equal(m.source.kind, 'plugin')
  assert.equal(m.source.plugin, 'dsh-prompt-injector')
  assert.equal(m.source.form, 'notice')
  assert.equal(m.source.summary, '图谱·Wiki 提醒')
  assert.equal(m.content[0].text, '正文')
})

test('makePromptMessage：空标题摘要回落「未命名」，无尾随空格（审计 P3）', () => {
  const m = makePromptMessage({ id: 'b', title: '', text: '正文', enabled: true })
  assert.equal(m.source.summary, '未命名')
})

test('shouldInject：freshUser 非琐碎 → 注入；琐碎按 skipTrivial 决定', () => {
  const real = { messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改 server/main.py' }] }] }
  const trivial = { messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '好的' }] }] }
  const toolStep = { messages: [{ source: { kind: 'tool' }, content: [{ type: 'text', text: '回执' }] }] }
  assert.equal(shouldInject(real, true), true)
  assert.equal(shouldInject(real, false), true)
  assert.equal(shouldInject(trivial, true), false)
  assert.equal(shouldInject(trivial, false), true)
  assert.equal(shouldInject(toolStep, true), false)
  assert.equal(shouldInject(toolStep, false), false)
})

test('isTrivialPrompt：问候/确认/继续为琐碎；实义内容不误伤', () => {
  for (const t of ['', '好的', '嗯', '收到', '继续', 'ok', '开始吧']) {
    assert.ok(isTrivialPrompt(t), `应为琐碎: ${t}`)
  }
  for (const t of ['继续帮我看看那个报错', '/api/v1 报错', '嗯，那图谱怎么刷新？']) {
    assert.ok(!isTrivialPrompt(t), `不应误伤: ${t}`)
  }
})