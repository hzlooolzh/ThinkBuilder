// 把 tbfd 的 6 个工具直接注册成 DSH 宿主工具（不再走 MCP 子进程）。
//
// 为什么不再走 MCP：MCP 连接是进程级的，instructions 与工具表全局共享，
// 无法知道"当前会话在哪个工作区"，只能靠 --project 钉死一个项目，于是别的
// 工作区会读到错误的流程图。宿主工具每次调用都能拿到 exec.agent.session，
// 从会话的 cwd 解析项目，天然就是对的。
import fs from 'node:fs'
import path from 'node:path'
import * as tb from './core.mjs'

const NO_PROJECT = `本工作区没找到 ThinkBuilder 项目（${tb.ROOT_SUFFIX} 后缀的文件夹）。请让用户在 ThinkBuilder 编辑器里把流程图导出到工作区根目录。`

/* ------------------------------------------------------ 定位项目 */

export function resolveProjectRoot(start) {
  if (!start) return null
  const p = path.resolve(start)
  try {
    if (!fs.statSync(p).isDirectory()) return null
  } catch {
    return null
  }
  if (path.basename(p).endsWith(tb.ROOT_SUFFIX)) return p
  const roots = tb.findProjectRoots(p, 3)
  if (roots.length === 1) return roots[0]
  if (roots.length > 1) {
    const named = roots.find((r) => path.basename(r) === path.basename(p) + tb.ROOT_SUFFIX)
    if (named) return named
    throw new Error(
      `${p} 下有多张流程图，无法替用户挑：\n` + roots.map((r) => `  ${r}`).join('\n') + '\n用 dir 参数指定其中一个。',
    )
  }
  return null
}

/** 会话的工作目录（模型最可能指的那个"工作区"）。 */
function sessionDir(exec) {
  try {
    const s = exec && exec.agent && exec.agent.session
    if (s && s.header && s.header.cwd) return s.header.cwd
  } catch {
    /* 忽略：拿不到就走显式 dir */
  }
  return null
}

/**
 * 显式 dir 优先；否则用会话 cwd；都没有才报错。
 * 显式 dir 给了但那里没有项目时也报错——静默回退会话目录会让人以为读的是别的项目。
 */
export function locate(exec, dir) {
  if (dir) {
    const root = resolveProjectRoot(String(dir))
    if (!root) throw new Error(`在 ${dir} 下没找到 ThinkBuilder 项目（${tb.ROOT_SUFFIX} 后缀的文件夹）。`)
    return root
  }
  const sd = sessionDir(exec)
  const root = sd ? resolveProjectRoot(sd) : null
  if (!root) throw new Error(NO_PROJECT)
  return root
}

/* ------------------------------------------------------ 输出整形 */

function fit(text, budget = 500) {
  if (tb.estimateTokens(text) <= budget) return text
  const lines = text.split('\n')
  let keep = lines.length
  const tail = (k) => `\n…+${lines.length - k} 行未显示，用 tb_children 下钻`
  while (keep > 1 && tb.estimateTokens(lines.slice(0, keep).join('\n') + tail(keep)) > budget) keep--
  return lines.slice(0, keep).join('\n') + tail(keep)
}

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render(_args, value) {
    return [{ type: 'text', text: value.text }]
  },
}

const DIR_SCHEMA = {
  type: 'string',
  description:
    '可选：工作区根目录（或某个 *__TBROOT__ 文件夹本身）。默认用当前会话的工作目录；只有想读别的工作区的项目时才传。',
}

const PARAMS = {
  dir: DIR_SCHEMA,
}

const ID = { type: 'string', description: '逻辑块 ID，如 0 / 0.2 / 0.2.1（全 ID，不是本层序号）' }

/* ------------------------------------------------------ 注册 */

/**
 * @param {object} ctx 一个已就绪的 cordis 上下文（含 tools 服务）
 * @param {(def: object) => object} defineTool 来自 @deepseek-ai/dsh-tools，缺省时原样返回
 */
export function registerTools(ctx, defineTool) {
  const define = typeof defineTool === 'function' ? defineTool : (d) => d
  const disposers = []

  const add = (def) => {
    try {
      const d = ctx.tools.register(define(def))
      if (typeof d === 'function') disposers.push(d)
    } catch (e) {
      ctx.logger?.warn?.(`thinkbuilder: 注册 ${def.name} 失败：${e.message}`)
    }
  }

  add({
    name: 'tb_boot',
    description:
      '读当前工作区的 ThinkBuilder 项目：完整读法（字段行/序号与全 ID/流向语法/菱形出口/工具用法）+ 根逻辑块（描述与顶层结构）+ 全项目块清单。凡涉及项目结构、需求、实现顺序的请求，先调它一次；之后用 tb_block 下钻。',
    parameters: { type: 'object', additionalProperties: false, properties: PARAMS },
    output: OUTPUT,
    async execute(args, exec) {
      const p = tb.loadProject(locate(exec, args.dir))
      return { text: fit(tb.renderBoot(p, 400), 900) }
    },
  })

  add({
    name: 'tb_block',
    description: '读一个逻辑块的完整描述（标题/完成/I/O/P/R）与它的直接子块、内部流向。做某块之前调。',
    parameters: { type: 'object', additionalProperties: false, properties: { ...PARAMS, id: ID }, required: ['id'] },
    output: OUTPUT,
    async execute(args, exec) {
      const p = tb.loadProject(locate(exec, args.dir))
      const text = tb.renderBlockBody(p, String(args.id))
      if (text == null) throw new Error(`没有逻辑块 ${args.id}。可用 tb_boot 看全部 ID。`)
      return { text: fit(text, 300) }
    },
  })

  add({
    name: 'tb_children',
    description: '只读一个逻辑块的子块清单与内部流向，不含描述文字。省 token 用。',
    parameters: { type: 'object', additionalProperties: false, properties: { ...PARAMS, id: ID }, required: ['id'] },
    output: OUTPUT,
    async execute(args, exec) {
      const p = tb.loadProject(locate(exec, args.dir))
      const text = tb.renderChildren(p, String(args.id))
      if (text == null) throw new Error(`没有逻辑块 ${args.id}。`)
      return { text: fit(text, 300) }
    },
  })

  add({
    name: 'tb_find',
    description: '按关键词搜逻辑块标题与描述，返回命中的 ID 列表。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { ...PARAMS, query: { type: 'string', description: '关键词' } },
      required: ['query'],
    },
    output: OUTPUT,
    async execute(args, exec) {
      const p = tb.loadProject(locate(exec, args.dir))
      return { text: fit(tb.renderFind(p, String(args.query || '')), 300) }
    },
  })

  add({
    name: 'tb_check',
    description: '校验流程图结构（菱形出边数=O 项数、S 无环、三角出边≤1 等），无问题返回 ok。',
    parameters: { type: 'object', additionalProperties: false, properties: PARAMS },
    output: OUTPUT,
    async execute(args, exec) {
      const p = tb.loadProject(locate(exec, args.dir))
      return { text: fit(tb.renderCheck(p), 400) }
    },
  })

  add({
    name: 'tb_set_done',
    description: '把某逻辑块标记为已完成/未完成（只改该块 _.tb 文件里的 D 行）。完成一个块后调用，编辑器里会显示 ✓。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { ...PARAMS, id: ID, done: { type: 'integer', enum: [0, 1], description: '1=已完成，0=未完成' } },
      required: ['id', 'done'],
    },
    output: OUTPUT,
    async execute(args, exec) {
      if (args.done !== 0 && args.done !== 1) throw new Error('done 只能是 0 或 1')
      const p = tb.loadProject(locate(exec, args.dir))
      const line = tb.setDone(p, String(args.id), args.done)
      return { text: `${args.id} ${line}` }
    },
  })

  return () => disposers.forEach((d) => d())
}

/** 系统提示里的一段：告诉模型"这里有流程图工具、先读再动手"。 */
export function promptSection() {
  return [
    '# ThinkBuilder 流程图',
    '当前工作区若存在 *__TBROOT__ 文件夹，说明有一张 ThinkBuilder 流程图：它只描述逻辑结构（字段含义、块之间的流向、每块的期望输入/输出/处理/规范），不代表真实代码目录。',
    '凡涉及项目结构、需求理解、实现顺序的问题，先调用 tb_boot 读整张图（它自带完整读法），再用 tb_block 逐块下钻；不要凭想象猜结构。',
    '流程图文件夹是只读的：不要修改其中的 _.tb；真实代码写在项目文件夹里、与根逻辑块文件夹平级。每完成一块，用 tb_set_done 标记。',
  ].join('\n')
}
