/**
 * dsh-prompt-injector host logic tests (node --test)
 * 覆盖：默认提示词要素、normPrompts 归一化兜底、makePromptMessage 形态
 * （form:'notice' + summary 纯标题，UI 自动加前缀）、shouldInject 决策。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PROMPTS, makePromptMessage, shouldInject, isTrivialPrompt, normPrompts } from '../src/logic.js'

test('默认提示词：一条「图谱·Wiki 提醒」，含判断语义', () => {
  assert.equal(DEFAULT_PROMPTS.length, 1)
  const p = DEFAULT_PROMPTS[0]
  assert.equal(p.id, 'graph-wiki')
  assert.equal(p.title, '图谱·Wiki 提醒')
  assert.equal(p.enabled, true)
  for (const part of ['code-review-graph update', 'crg search/impact/stats', 'gmcp search', '不是每轮都要查', '纯闲聊、纯算术、无事实成分的简单操作 → 跳过']) {
    assert.ok(p.text.includes(part), `默认文本应包含: ${part}`)
  }
})

test('normPrompts：非法输入兜底（非数组→默认；undefined→默认）', () => {
  assert.equal(normPrompts(undefined).length, 1)
  assert.equal(normPrompts('bad').length, 1)
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