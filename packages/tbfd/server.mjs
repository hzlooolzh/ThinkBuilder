#!/usr/bin/env node
// tbfd —— thinkbuilder_for_dsh。零依赖、手写 MCP stdio JSON-RPC。
// 用法：node server.mjs [--project <目录>]      （不带参数则从 cwd 向上找 __TBROOT__）
import { createInterface } from 'node:readline'
import path from 'node:path'
import fs from 'node:fs'
import * as tb from '../core/index.mjs'

const argv = process.argv.slice(2)
const argOf = (n) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : null
}
const EXPLICIT = argOf('--project') || process.env.TB_PROJECT || null

/* ------------------------------------------------------ 定位项目 */

function resolveProjectRoot(start) {
  if (!start) return null
  const p = path.resolve(start)
  try {
    if (!fs.statSync(p).isDirectory()) return null
  } catch {
    return null
  }
  const base = path.basename(p)
  if (base.endsWith(tb.ROOT_SUFFIX)) return p
  // 直接子目录里有唯一 __TBROOT__
  const roots = tb.findProjectRoots(p, 3)
  if (roots.length === 1) return roots[0]
  if (roots.length > 1) {
    const named = roots.find((r) => path.basename(r) === base + tb.ROOT_SUFFIX)
    if (named) return named
  }
  return null
}

const PROJECT = resolveProjectRoot(EXPLICIT || process.cwd())

function load(root) {
  const dir = root || PROJECT
  if (!dir) throw new Error(NO_PROJECT)
  const project = tb.loadProject(dir)
  return project
}

/**
 * 工具级项目定位：任一工具都可以传 dir（工作区根目录或 __TBROOT__ 文件夹本身），
 * 因为 MCP 连接是进程级的、服务器不知道"当前会话在哪个工作区"。
 * 不传 dir 时回退到启动参数 --project / TB_PROJECT / cwd 推导。
 */
function pickProject(dir) {
  if (!dir) {
    if (!PROJECT) throw new Error(NO_PROJECT)
    return PROJECT
  }
  const root = resolveProjectRoot(String(dir))
  if (!root) {
    throw new Error(
      `在 ${dir} 下没找到 ThinkBuilder 项目（${tb.ROOT_SUFFIX} 后缀的文件夹）。` +
        `请确认目录正确，或在 ThinkBuilder 里把流程图导出到该工作区。`,
    )
  }
  return root
}

const NO_PROJECT = `本工作区没找到 ThinkBuilder 项目（${tb.ROOT_SUFFIX} 后缀的文件夹）。请让用户在 ThinkBuilder 里导出流程图到工作区根目录。`

/* ------------------------------------------------------ 输出整形 */

function fit(text, budget = 500) {
  if (tb.estimateTokens(text) <= budget) return text
  const lines = text.split('\n')
  let keep = lines.length
  const tail = (k) => `\n…+${lines.length - k} 行未显示，用 tb_children 下钻`
  while (keep > 1 && tb.estimateTokens(lines.slice(0, keep).join('\n') + tail(keep)) > budget) keep--
  return lines.slice(0, keep).join('\n') + tail(keep)
}

const okText = (text) => ({ content: [{ type: 'text', text: String(text) }] })
const errText = (text) => ({ content: [{ type: 'text', text: String(text) }], isError: true })

/* ------------------------------------------------------ 工具 */

const TOOLS = [
  {
    name: 'tb_boot',
    description: '读项目逻辑骨架：完整读法（字段行/序号与全 ID/流向语法/菱形出口/工具用法）+ 根逻辑块（描述与顶层结构）+ 全项目块清单。会话开始时先调一次，之后的 tb_block 不再带读法。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tb_block',
    description: '读一个逻辑块的完整描述（I/O/P/R）与其直接子块、内部流向。做某块之前调。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '逻辑块 ID，如 0 / 0.2 / 0.2.1' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'tb_children',
    description: '只读一个逻辑块的子块清单与流向，不含描述文字。省 token 用。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'tb_find',
    description: '按关键词搜逻辑块标题与描述，返回命中的 ID 列表。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'tb_check',
    description: '校验流程图结构（菱形出边数=O项数、S 无环、三角出边≤1 等），无问题返回 ok。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tb_set_done',
    description: '把某逻辑块标记为已完成/未完成（只改该块 _ tb 文件里的 D 行）。完成一个块后调用。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, done: { type: 'integer', enum: [0, 1], description: '1=已完成，0=未完成' } },
      required: ['id', 'done'],
      additionalProperties: false,
    },
  },
]

const DIR_SCHEMA = {
  type: 'string',
  description: '工作区根目录（或某个 *__TBROOT__ 文件夹本身）。省略则用服务器启动时定位的项目；当前会话的工作区与默认项目不一致时必须传它。',
}
for (const t of TOOLS) t.inputSchema.properties.dir = DIR_SCHEMA

function callTool(name, args = {}) {
  if (name === 'tb_boot') {
    const p = load(pickProject(args.dir))
    return okText(fit(tb.renderBoot(p, 400), 900))
  }
  if (name === 'tb_block') {
    const p = load(pickProject(args.dir))
    const text = tb.renderBlockBody(p, String(args.id))
    if (text == null) return errText(`没有逻辑块 ${args.id}。可用 tb_boot 看全部 ID。`)
    return okText(fit(text, 300))
  }
  if (name === 'tb_children') {
    const p = load(pickProject(args.dir))
    const text = tb.renderChildren(p, String(args.id))
    if (text == null) return errText(`没有逻辑块 ${args.id}。`)
    return okText(fit(text, 300))
  }
  if (name === 'tb_find') {
    const p = load(pickProject(args.dir))
    return okText(fit(tb.renderFind(p, String(args.query || '')), 300))
  }
  if (name === 'tb_check') {
    const p = load(pickProject(args.dir))
    return okText(fit(tb.renderCheck(p), 400))
  }
  if (name === 'tb_set_done') {
    const root = pickProject(args.dir)
    const p = load(root)
    if (args.done !== 0 && args.done !== 1) return errText('done 只能是 0 或 1')
    const line = tb.setDone(p, String(args.id), args.done)
    return okText(`${args.id} ${line}`)
  }
  return errText(`未知工具 ${name}`)
}

/* ------------------------------------------------------ MCP 循环 */

const VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const DIRECTIVE =
  '# 本会话已挂载 ThinkBuilder 流程图工具（tbfd）。凡与项目结构、需求、实现顺序有关的请求，先调用 tb_boot 读流程图再回答，不要凭想象猜结构。\n' +
  '# 所有工具都接受可选参数 dir=<工作区根目录>（或某个 *__TBROOT__ 文件夹）；不传时用服务器启动时定位的默认项目。工作区与默认项目不同时必须传 dir。\n'
const SCOPE_WARNING = (project) =>
  `# 作用域：下面注入的流程图属于 ${project}。**只有当当前会话的工作区就是这个项目时**才可用它；` +
  '否则这些内容与本会话无关，忽略它们，改用 tb_boot(dir=<当前工作区根目录>) 读取本工作区的项目。\n'
let instructions = null
function getInstructions() {
  if (instructions != null) return instructions
  if (!PROJECT) {
    instructions =
      DIRECTIVE +
      NO_PROJECT +
      '\n调用任何工具时传 dir=<当前工作区根目录>。流程图夹是只读的：它只描述逻辑结构，不要改动其中的 _.tb；真实工程写在项目文件夹里、与根逻辑块文件夹平级。'
    return instructions
  }
  try {
    const p = tb.loadProject(PROJECT)
    // 读法已在 LEGEND 里，这里不再追加说明，省 token
    instructions = fit(DIRECTIVE + SCOPE_WARNING(PROJECT) + tb.renderBoot(p, 400), 1500)
  } catch (e) {
    instructions = DIRECTIVE + `ThinkBuilder 项目读取失败：${e.message}`
  }
  return instructions
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handle(req) {
  const { id, method, params } = req
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } })
  switch (method) {
    case 'initialize': {
      const v = params && params.protocolVersion
      // 回显客户端版本：探针与正式连接可能用不同修订号，回显最兼容
      const echo = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : VERSIONS[VERSIONS.length - 1]
      return reply({
        protocolVersion: echo,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'tbfd', version: '0.1.0' },
        instructions: getInstructions(),
      })
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'resources/list':
      return reply({ resources: [] })
    case 'prompts/list':
      return reply({ prompts: [] })
    case 'tools/call': {
      const name = params && params.name
      const args = (params && params.arguments) || {}
      try {
        return reply(callTool(name, args))
      } catch (e) {
        return reply(errText(e.message))
      }
    }
    default:
      return fail(-32601, `Method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const s = line.trim()
  if (!s) return
  let req
  try {
    req = JSON.parse(s)
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  if (Array.isArray(req)) return req.forEach(handle)
  handle(req)
})
rl.on('close', () => process.exit(0))
