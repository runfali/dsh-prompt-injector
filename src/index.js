/**
 * dsh-prompt-injector — 通用每轮上下文注入插件（host 半）。
 *
 * 与 dsh-mem0-plugins 的注入机制同构（agent/pre-step → decision.messages 追加
 * form:'notice' 的 plugin-source 用户消息），但完全通用化：配置里每一条
 * enabled 提示词 → 每轮对话追加一条 notice 行（summary 即标题，UI 自动加
 * 「上下文注入」前缀与插件名）。
 *
 * 配置（设置页可编辑，settings.yaml 用户层持久化）：
 *   enabled      —— 总开关
 *   skipTrivial  —— 琐碎轮（问候/确认/继续等）是否跳过注入，默认 true
 *   prompts[]    —— 提示词列表 { id, title, text, enabled }，默认内置一条
 *                   「图谱·Wiki 提醒」（编码任务消费图谱 + 事实问题先查 wiki，
 *                   按需执行的判断语义——不是每轮都要查）
 *
 * 只提醒、不执行：插件不调用任何图谱/wiki 命令，判断权在模型。
 */

import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_PROMPTS, normPrompts, shouldInject, makePromptMessage } from './logic.js'

export const PROMPT_INJECTOR_NAMESPACE = settingsNamespace('prompt-injector')

const PromptSchema = z.object({
  id: z.string().default(''),
  title: z.string().default(''),
  text: z.string().default(''),
  enabled: z.boolean().default(true)
})

const Config = z.object({
  enabled: z.boolean().default(true),
  skipTrivial: z.boolean().default(true),
  prompts: z.array(PromptSchema).default(DEFAULT_PROMPTS)
})

// installSettingsSection 内部已自行 ctx.inject(['settings'])，此处只需 agents（backfill 枚举用）。
export const inject = ['agents']

export function apply(ctx, config = {}) {
  let current = () => config
  installSettingsSection(ctx, PROMPT_INJECTOR_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // 各消费点每轮读取 current()，无需主动刷新
    }
  })

  const spec = () => {
    const value = current() || {}
    return {
      enabled: value.enabled !== false,
      skipTrivial: value.skipTrivial !== false,
      prompts: normPrompts(value.prompts)
    }
  }

  const hookedAgents = new WeakSet()

  const installAgentHooks = (agent) => {
    if (!agent || !agent.id || !agent.ctx) return
    if (hookedAgents.has(agent)) return
    hookedAgents.add(agent)

    agent.ctx.on('agent/pre-step', async (payload, next) => {
      // 第一阶段：执行下游链节。若下游抛错，不重放、向上传播
      // （重放会让下游副作用执行两次——继承上游的隐患，2026-08-26 第二轮审计修）。
      let decision
      try {
        decision = await next()
      } catch (error) {
        ctx.logger.debug('[dsh-prompt-injector] downstream pre-step error: ' + String((error && error.message) || error))
        throw error
      }
      // 第二阶段：只做纯内存注入；任何异常都回退原决策，不破坏本轮。
      try {
        if (!decision || decision.kind !== 'enter' || !decision.messages) return decision
        const s = spec()
        if (!s.enabled) return decision
        if (!shouldInject(payload, s.skipTrivial)) return decision
        const reminders = s.prompts
          .filter((p) => p.enabled && p.text)
          .map((p) => makePromptMessage(p))
        if (!reminders.length) return decision
        return { kind: 'enter', messages: [...decision.messages, ...reminders] }
      } catch (error) {
        ctx.logger.debug('[dsh-prompt-injector] injection failed: ' + String((error && error.message) || error))
        return decision
      }
    })
    ctx.logger.debug('[dsh-prompt-injector] hooks installed for agent ' + agent.id)
  }

  // 新 agent 挂载
  ctx.effect(
    () => ctx.on('agent/created', (payload) => installAgentHooks(payload && payload.agent)),
    'pi:agent-hooks'
  )

  // 补挂既有 agent（插件晚于 agent 创建时，agent/created 已错过）
  const agentsRegistry = ctx.get && typeof ctx.get === 'function' ? ctx.get('agents') : undefined
  const agentsService = agentsRegistry || ctx.agents
  if (agentsService && typeof agentsService.list === 'function') {
    try {
      const existing = agentsService.list()
      if (existing && existing.length) {
        for (const agent of existing) installAgentHooks(agent)
        ctx.logger.debug('[dsh-prompt-injector] backfilled ' + existing.length + ' pre-existing agent(s)')
      }
    } catch (error) {
      ctx.logger.debug('[dsh-prompt-injector] existing-agent backfill failed: ' + String((error && error.message) || error))
    }
  }
}