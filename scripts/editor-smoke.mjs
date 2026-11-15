#!/usr/bin/env node
// 编辑器宿主路由冒烟：不启动 DSH，用假 ctx 把 handler 挂到临时 http 服务上跑真实请求。
// node scripts/editor-smoke.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { apply } from '../packages/editor-ui/index.js'

const ROOT = path.resolve(import.meta.dirname, '..')
let fails = 0
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.log(`  ✗ ${msg}`)
    fails++
  }
}

let handler = null
// 假 ctx：webServer 立即就绪；inject 同步回调（真实 cordis 是等依赖变化，这里只验路由）
const fakeWeb = { register: (route) => ((handler = route.handler), () => {}) }
const fakeCtx = {
  webServer: fakeWeb,
  get: (k) => (k === 'webServer' ? fakeWeb : undefined),
  effect: (fn) => fn(),
}
fakeCtx.inject = (deps, cb) => cb(fakeCtx)
apply(fakeCtx)
ok(typeof handler === 'function', 'apply() 注册了 /thinkbuilder 路由')

const server = http.createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/thinkbuilder/api`
const get = async (p) => {
  const r = await fetch(base + p)
  return { status: r.status, body: await r.json() }
}
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-editor-'))
const src = path.join(ROOT, 'fixtures', 't2-medium')
fs.cpSync(src, tmp, { recursive: true })
// fixture 目录里可能留着编辑器存过的 .thinkbuilder 状态；这条用例只测"从树读"
fs.rmSync(path.join(tmp, '.thinkbuilder'), { recursive: true, force: true })

try {
  ok((await get('/ping')).body.ok, 'ping')
  const list = await get(`/projects?dir=${encodeURIComponent(tmp)}`)
  ok(list.body.ok && list.body.projects.length === 1, `发现工程 ${list.body.projects && list.body.projects.length}`)

  const loaded = await post('/load', { dir: tmp })
  ok(loaded.body.ok && loaded.body.source === 'tree', `load 来源=${loaded.body.source}`)
  ok(loaded.body.ir && Object.keys(loaded.body.ir.blocks).length === 12, `load 块数 ${loaded.body.ir && Object.keys(loaded.body.ir.blocks).length}`)
  ok(loaded.body.stats.bootTokens > 0, `boot ${loaded.body.stats.bootTokens} tok`)

  const saved = await post('/save', { dir: tmp, ir: loaded.body.ir })
  ok(saved.body.ok && fs.existsSync(path.join(tmp, '.thinkbuilder', 'project.json')), 'save 写了 .thinkbuilder/project.json')

  const again = await post('/load', { dir: tmp })
  ok(again.body.source === 'json', '再 load 走 json')

  // 导出到另一个目录：机械结构必须是 <目标>/<项目名>/<项目名>__TBROOT__/...
  const outTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-out-'))
  const before = fs.readFileSync(path.join(tmp, '记账小程序__TBROOT__', '录入', '_.tb'), 'utf8')
  const exp = await post('/export', { dir: tmp, ir: again.body.ir, target: outTmp })
  ok(exp.body.ok && exp.body.files === 12, `export 写了 ${exp.body.files} 个文件`)
  const projOut = path.join(outTmp, '记账小程序')
  ok(exp.body.projectDir === projOut, `导出落在项目文件夹：${exp.body.projectDir}`)
  ok(fs.existsSync(path.join(projOut, '记账小程序__TBROOT__', '录入', '_.tb')), '项目文件夹里才有 <项目名>__TBROOT__')
  const after = fs.readFileSync(path.join(projOut, '记账小程序__TBROOT__', '录入', '_.tb'), 'utf8')
  ok(before === after, '机械导出与原件逐字节相同')
  // 第二次导出前会把旧树备份到 <项目文件夹>/.thinkbuilder/backup/<时间戳>
  const expB = await post('/export', { dir: tmp, ir: again.body.ir, target: outTmp })
  ok(expB.body.backup && fs.existsSync(expB.body.backup) && expB.body.backup.includes(`${path.sep}.thinkbuilder${path.sep}backup${path.sep}`), `导出前备份了旧树：${expB.body.backup}`)

  const chk = await post('/check', { ir: again.body.ir })
  ok(chk.body.text === 'ok', `check = ${chk.body.text}`)

  const bad = JSON.parse(JSON.stringify(again.body.ir))
  const p0 = bad.blocks[bad.rootId]
  bad.blocks[p0.children[0]].title = p0.children[1] ? bad.blocks[p0.children[1]].title : 'x'
  const dup = await post('/export', { dir: tmp, ir: bad })
  ok(dup.status === 400 && /同名|标题/.test(dup.body.error || ''), `重名被拦：${(dup.body.error || '').split('\n')[0]}`)

  // 改一个标题再导出，树里必须跟着改名
  const edit = JSON.parse(JSON.stringify(again.body.ir))
  const r0 = edit.blocks[edit.rootId]
  const c1 = edit.blocks[r0.children[1]]
  c1.title = '统计改名'
  const exp2 = await post('/export', { dir: tmp, ir: edit, target: outTmp })
  ok(exp2.body.ok && fs.existsSync(path.join(projOut, '记账小程序__TBROOT__', '统计改名', '_.tb')), '改名后目录跟着重建')
  fs.rmSync(outTmp, { recursive: true, force: true })
} catch (e) {
  console.log(`  ✗ 异常：${e.stack || e.message}`)
  fails++
} finally {
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
