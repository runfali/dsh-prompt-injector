/**
 * dsh-prompt-injector — 纯逻辑模块（零依赖，便于单测）。
 * host 入口 src/index.js 从这里导入；不依赖 dsh-settings / schemastery。
 */

/** 默认内置提示词：图谱消费链路 + wiki 先查（按需执行的判断语义）。
 * 用户可在设置页增删改；此默认仅在用户层无 prompts 时生效。 */
export const DEFAULT_PROMPTS = [
  {
    id: 'graph-wiki',
    title: '图谱·Wiki 提醒',
    enabled: true,
    text: [
      '[graph-wiki requirement] 本轮开始，先判断是否需要查图谱/Wiki，再决定是否执行——不是每轮都要查：',
      '① 编码任务（本轮要改代码）→ 消费图谱：目标仓库先 `code-review-graph update` 刷新（无图谱则自动建库），然后 `crg search/impact/stats` 查询（多仓库自动发现：--repo <别名|路径> > 当前目录 .git 根 > 兜底 mem0_falkordb；`crg xsearch` 全仓搜索），深层结构用 graphify 查询（graphify-mcp 5566）。只改文档/纯叙述/无代码改动则跳过刷新。',
      '② 技术事实类问题（版本/行为/配置/术语/流程步骤）→ 先 `gmcp search \'{"query":"..."}\'` 查 wiki（score≥0.45 取前 3 页，读页后再答，标注 [[wikilink]] 来源）。',
      '③ 纯闲聊、纯算术、无事实成分的简单操作 → 跳过，直接回答。',
      '若不确定属于哪类：宁可查一次（gmcp 或 crg 成本低），不要凭记忆给过时答案。'
    ].join('\n')
  }
]

/** 提示词列表防御性收敛（外部编辑 settings.yaml 时兜底）。 */
export function normPrompts(raw) {
  if (!Array.isArray(raw)) return DEFAULT_PROMPTS.slice()
  const out = []
  raw.forEach((p, i) => {
    if (!p || typeof p !== 'object') return
    out.push({
      id: String((p.id !== undefined && p.id !== null && p.id !== '') ? p.id : ('p' + i)),
      title: String(p.title !== undefined && p.title !== null ? p.title : '').trim(),
      text: String(p.text !== undefined && p.text !== null ? p.text : ''),
      enabled: p.enabled !== false
    })
  })
  if (!out.length) return DEFAULT_PROMPTS.slice()
  return out
}

/** 琐碎输入判定：空/纯标点/斜杠命令/纯问候确认。移植自 dsh-mem0-plugins
 *  src/guards.js（hermes is_trivial_prompt 的中文扩充），MIT 许可。 */
const TRIVIAL_PROMPT_RE = new RegExp(
  '^(?:' +
  'yes|no|ok|okay|sure|thanks|thank you|yep|nope|yeah|nah|y|n|k|' +
  '好|好的|好哒|好嘞|嗯|嗯嗯|哦|噢|噢噢|行|行吧|可以|对|对的|是的|是|没错|' +
  '收到|了解|明白了|明白|知道了|知道|中|妥|' +
  '不|不用|不用了|不了|算了|没有|没|' +
  '谢谢|多谢|感谢|辛苦了|麻烦了|' +
  'hi|hey|hello|yo|sup|' +
  '你好|您好|哈喽|嗨|嗨嗨|在吗|在么|' +
  'continue|go ahead|do it|proceed|got it|cool|nice|great|done|next|lgtm|' +
  '继续|接着来|请继续|下一步|开始吧|就这样|搞定|完成' +
  ')' +
  '[\\s!?.:;,"\'~’“”—–…()\\[\\]{}<>*&^%$#@!+=`\\u00a0' +
  '。，！？；：、“”‘’《》【】（）～…·—]*$',
  'i'
)
const SLASH_COMMAND_RE = /^\/[a-zA-Z][\w-]{0,23}$/

export function isTrivialPrompt(text) {
  if (!text) return true
  const stripped = String(text).trim()
  if (!stripped) return true
  if (!stripped.replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')) return true
  if (SLASH_COMMAND_RE.test(stripped)) return true
  return TRIVIAL_PROMPT_RE.test(stripped)
}

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function genId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'pi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** 单条提示词 → notice 消息（summary = 「上下文注入 <title>」）。 */
export function makePromptMessage(prompt) {
  return {
    id: genId(),
    role: 'user',
    content: [{ type: 'text', text: prompt.text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-prompt-injector',
      form: 'notice',
      summary: '上下文注入 ' + prompt.title
    }
  }
}

/** 判断本轮是否需要注入提醒：有 freshUser 才注入；skipTrivial 时琐碎输入跳过。 */
export function shouldInject(payload, skipTrivial) {
  const freshUser = ((payload && payload.messages) || []).find(
    (m) => m && m.source && m.source.kind === 'user'
  )
  if (!freshUser) return false
  if (skipTrivial !== true) return true
  return !isTrivialPrompt(textOfBlocks(freshUser.content))
}