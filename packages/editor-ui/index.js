// ThinkBuilder 编辑器 —— 宿主半边。
// 只做三件事：把 IR 存成 JSON、把 IR 机械导出成 tbfd 可读的文件夹、把导出树读回 IR。
// 客户端（DSH 面板）通过同源 HTTP 路由调用，路由前缀 /thinkbuilder。
import fs from 'node:fs'
import path from 'node:path'
import {
  TB_FILE,
  ROOT_SUFFIX,
  exportProject,
  importProject,
  irToProject,
  renderCheck,
  renderBoot,
  estimateTokens,
  LEGEND,
  validate,
  autoLayout,
} from './core.mjs'
import { registerTools, promptSection } from './tools.js'

// 这个 cordis 版本的 inject 只认"服务名数组/名字→配置对象"，没有 optional 语义，
// 所以 webServer 用 ctx.get() 取（宿主半边在非 web profile 里静默不注册）。
const PREFIX = '/thinkbuilder'
const STATE_DIR = '.thinkbuilder'
const STATE_FILE = 'project.json'

const json = (res, code, data) => {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

const bad = (res, msg, code = 400) => json(res, code, { ok: false, error: msg })

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 8 * 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(new Error(`JSON 解析失败：${e.message}`))
      }
    })
    req.on('error', reject)
  })

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

const hasTb = (p) => fs.existsSync(path.join(p, TB_FILE))

// 目录里有没有"编辑器工程"：已有 JSON 状态，或直接含 <名字>__TBROOT__ 子目录
const isProjectDir = (dir) => {
  if (fs.existsSync(path.join(dir, STATE_DIR, STATE_FILE))) return true
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return items.some((e) => e.isDirectory() && e.name.endsWith(ROOT_SUFFIX))
}

const listProjects = (root, maxDepth = 3) => {
  const out = []
  const seen = new Set()
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    if (isProjectDir(dir)) {
      const real = path.resolve(dir).toLowerCase()
      if (!seen.has(real)) {
        seen.add(real)
        out.push({ dir, title: guessTitle(dir), state: fs.existsSync(path.join(dir, STATE_DIR, STATE_FILE)) })
      }
    }
    let items = []
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of items) {
      if (!e.isDirectory()) continue
      const name = e.name
      if (name.startsWith('.') || name === 'node_modules') continue
      if (name.endsWith(ROOT_SUFFIX)) continue
      walk(path.join(dir, name), depth + 1)
    }
  }
  walk(root, 0)
  return out
}

const guessTitle = (dir) => {
  try {
    const raw = fs.readFileSync(path.join(dir, STATE_DIR, STATE_FILE), 'utf8')
    const ir = JSON.parse(raw)
    if (ir && typeof ir.title === 'string') return ir.title
  } catch {}
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return path.basename(dir)
  }
  const root = items.find((e) => e.isDirectory() && e.name.endsWith(ROOT_SUFFIX))
  if (root) return root.name.slice(0, -ROOT_SUFFIX.length)
  return path.basename(dir)
}

const statePath = (dir) => path.join(dir, STATE_DIR, STATE_FILE)

const safeTitle = (title) => {
  if (typeof title !== 'string' || !title.trim()) throw new Error('项目名不能为空')
  if (/[\\/:*?"<>|]/.test(title)) throw new Error(`项目名不能包含 \\ / : * ? " < > |：${title}`)
  if (title.trim() !== title) throw new Error('项目名首尾不能有空格')
  return title
}

// 标题就是文件夹名：同层不能重名、不能有空标题、不能以点开头（加载器会跳过）
const titleIssues = (ir) => {
  const out = []
  const bad = (t) => {
    if (!t || !String(t).trim()) return '标题为空'
    if (/[\\/:*?"<>|]/.test(t)) return '含 \\ / : * ? " < > |'
    if (String(t).trim() !== t) return '首尾有空格'
    if (String(t).startsWith('.')) return '以 . 开头（会被当隐藏目录跳过）'
    return null
  }
  for (const b of Object.values(ir.blocks)) {
    // 起止圆不进导出树，它们的标题不参与任何命名约束（多个「结束」小圆是允许的）
    if (b.kind === 'c') continue
    const why = bad(b.title)
    if (why) out.push(`块 ${b.id} 的标题${why}：${JSON.stringify(b.title)}`)
  }
  for (const b of Object.values(ir.blocks)) {
    const seen = new Set()
    for (const c of b.children) {
      const cb = ir.blocks[c]
      if (!cb || cb.kind === 'c') continue
      if (seen.has(cb.title)) out.push(`「${b.title}」这一层有两个同名子块：${cb.title}`)
      seen.add(cb.title)
    }
  }
  return out
}

// 老版本存下来的工程里所有块都是 layout {0,0}：这种情况按一次自动排版救回来
const needsLayout = (ir) => {
  for (const b of Object.values(ir.blocks)) {
    if (!b.children || !b.children.length) continue
    const seen = new Set()
    for (const c of b.children) {
      const k = ir.blocks[c]
      if (!k || !k.layout) continue
      const key = `${k.layout.x},${k.layout.y}`
      if (seen.has(key)) return true
      seen.add(key)
    }
  }
  return false
}

const loadIr = (dir) => {
  if (!path.isAbsolute(dir)) throw new Error('需要一个绝对路径')
  if (fs.existsSync(statePath(dir))) {
    const ir = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'))
    if (ir && ir.blocks && ir.blocks[ir.rootId]) {
      if (needsLayout(ir)) autoLayout(ir)
      return { ir, source: 'json' }
    }
    throw new Error('project.json 内容不是 TB 编辑器工程')
  }
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`目录打不开：${dir}`)
  }
  const root = items.find((e) => e.isDirectory() && e.name.endsWith(ROOT_SUFFIX))
  if (!root) throw new Error('这个目录里没有 .thinkbuilder/project.json，也没有 *__TBROOT__')
  return { ir: importProject(path.join(dir, root.name)), source: 'tree' }
}

const stats = (ir) => {
  const p = irToProject(ir)
  const boot = renderBoot(p, 400)
  const blocks = Object.keys(ir.blocks).length
  return { blocks, bootTokens: estimateTokens(boot), legendTokens: estimateTokens(LEGEND), bytes: Buffer.byteLength(boot, 'utf8') }
}

const backupTree = (dir, title) => {
  const root = path.join(dir, `${title}${ROOT_SUFFIX}`)
  if (!fs.existsSync(root)) return null
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
  const dest = path.join(dir, STATE_DIR, 'backup', stamp)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(root, dest, { recursive: true })
  return dest
}

const saveIr = (dir, ir) => {
  safeTitle(ir.title)
  fs.mkdirSync(path.join(dir, STATE_DIR), { recursive: true })
  fs.writeFileSync(statePath(dir), JSON.stringify(ir, null, 1), 'utf8')
  return statePath(dir)
}

// 导出地址选择器的起点：Windows 列盘符，其他平台给根目录
const rootsOf = () => {
  if (process.platform !== 'win32') return [{ name: '/', path: '/' }]
  const out = []
  for (let c = 65; c <= 90; c++) {
    const p = `${String.fromCharCode(c)}:\\`
    try {
      if (fs.statSync(p).isDirectory()) out.push({ name: p, path: p })
    } catch {}
  }
  return out
}

const route = async (req, res) => {
  const url = new URL(req.url || '/', 'http://thinkbuilder.local')
  const p = url.pathname.replace(/\/+$/, '')
  const method = req.method || 'GET'
  try {
    if (p === `${PREFIX}/api/ping`) return json(res, 200, { ok: true })
    if (p === `${PREFIX}/api/projects`) {
      const dir = url.searchParams.get('dir') || ''
      if (!dir || !path.isAbsolute(dir)) return bad(res, '需要绝对路径 dir')
      if (!isDir(dir)) return bad(res, `目录不存在：${dir}`)
      return json(res, 200, { ok: true, dir, projects: listProjects(dir) })
    }
    if (p === `${PREFIX}/api/dirs`) {
      const raw = url.searchParams.get('path') || ''
      if (!raw) return json(res, 200, { ok: true, path: '', parent: null, dirs: rootsOf() })
      if (!path.isAbsolute(raw)) return bad(res, '需要绝对路径 path')
      if (!isDir(raw)) return bad(res, `目录不存在：${raw}`)
      const dirs = []
      for (const ent of fs.readdirSync(raw, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue
        const full = path.join(raw, ent.name)
        dirs.push({ name: ent.name, path: full, tb: fs.existsSync(path.join(full, ROOT_SUFFIX)) || fs.existsSync(path.join(full, STATE_DIR)) })
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      const parent = path.dirname(raw)
      return json(res, 200, { ok: true, path: raw, parent: parent === raw ? null : parent, dirs })
    }
    if (method !== 'POST') return bad(res, `不支持的方法 ${method}`, 405)
    const body = await readBody(req)
    if (p === `${PREFIX}/api/load`) {
      const { dir } = body
      const { ir, source } = loadIr(dir)
      return json(res, 200, { ok: true, dir, source, ir, stats: stats(ir) })
    }
    if (p === `${PREFIX}/api/save`) {
      const { dir, ir } = body
      if (!ir || !ir.blocks) return bad(res, '缺少 ir')
      const file = saveIr(dir, ir)
      return json(res, 200, { ok: true, file, stats: stats(ir) })
    }
    if (p === `${PREFIX}/api/export`) {
      const { dir, ir, target } = body
      if (!ir || !ir.blocks) return bad(res, '缺少 ir')
      safeTitle(ir.title)
      const outDir = target ? String(target) : dir
      if (!path.isAbsolute(outDir)) return bad(res, `导出地址必须是绝对路径：${outDir}`)
      if (!isDir(outDir)) return bad(res, `导出地址不存在：${outDir}`)
      const clashes = titleIssues(ir)
      if (clashes.length) return bad(res, `标题有问题，无法机械导出：\n${clashes.join('\n')}`)
      const backup = backupTree(path.join(outDir, ir.title), ir.title)
      const written = exportProject(ir, outDir)
      saveIr(dir, ir)
      const pj = irToProject(ir)
      const issues = validate(pj)
      const errs = issues.filter((i) => i.level === '错')
      const warns = issues.filter((i) => i.level === '告警')
      return json(res, 200, {
        ok: true,
        projectDir: written.projectDir,
        rootDir: written.rootDir,
        files: written.files.length,
        backup,
        errors: errs.length,
        warnings: warns.length,
        stats: stats(ir),
      })
    }
    if (p === `${PREFIX}/api/check`) {
      const { ir } = body
      if (!ir || !ir.blocks) return bad(res, '缺少 ir')
      return json(res, 200, { ok: true, text: renderCheck(irToProject(ir)), stats: stats(ir) })
    }
    return bad(res, `未知接口 ${p}`, 404)
  } catch (e) {
    return bad(res, e && e.message ? e.message : String(e))
  }
}

export async function apply(ctx) {
  // 工具 + 系统提示：让模型"先读流程图再动手"，项目按会话工作目录定位。
  // defineTool 来自 dsh 自带的 @deepseek-ai/dsh-tools；解析不到就退回裸定义（结构等价）。
  let define = null
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    define = mod.defineTool
  } catch {
    define = null
  }
  ctx.inject(['tools'], (inner) => {
    const off = registerTools(inner, define)
    inner.effect(() => off, 'thinkbuilder: tools')
  })
  ctx.inject(['systemPrompt'], (inner) => {
    const off = inner.systemPrompt.section({ name: 'thinkbuilder', order: 30, text: promptSection() })
    if (typeof off === 'function') inner.effect(() => off, 'thinkbuilder: prompt')
  })

  // webServer 是可选服务：用 ctx.inject 等它出现再挂路由。
  // 直接 ctx.get('webServer') 在服务尚未就绪时会拿到 undefined，插件虽然 active 但路由永远不注册。
  ctx.inject(['webServer'], (ctx) => {
    const web = ctx.webServer
    if (!web || typeof web.register !== 'function') return
    const dispose = web.register({ kind: 'prefix', path: PREFIX, handler: route })
    if (typeof dispose === 'function') ctx.effect(() => dispose, 'thinkbuilder: http route')
  })
}
