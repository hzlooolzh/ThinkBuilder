#!/usr/bin/env node
// tbfd 的命令行版：不接 DSH 也能看 AI 到底会收到什么。
// node packages/tbfd/cli.mjs <boot|block|children|find|check|done|tokens|ids> [参数] [--project <目录>]
import path from 'node:path'
import fs from 'node:fs'
import * as tb from '../core/index.mjs'

const argv = process.argv.slice(2)
const pi = argv.indexOf('--project')
const explicit = pi >= 0 ? argv[pi + 1] : null
const args = argv.filter((a, i) => !(a === '--project' || (pi >= 0 && i === pi + 1)))
const cmd = args[0]

function resolveProjectRoot(start) {
  const p = path.resolve(start || process.cwd())
  if (path.basename(p).endsWith(tb.ROOT_SUFFIX)) return p
  const roots = tb.findProjectRoots(p, 3)
  if (roots.length === 1) return roots[0]
  const named = roots.find((r) => path.basename(r) === path.basename(p) + tb.ROOT_SUFFIX)
  return named || roots[0] || null
}

const rootDir = resolveProjectRoot(explicit)
if (!rootDir) {
  console.error(`找不到项目：在 ${path.resolve(explicit || process.cwd())} 下没有 *${tb.ROOT_SUFFIX} 文件夹`)
  process.exit(2)
}
const project = tb.loadProject(rootDir)
const out = (s) => console.log(s)

switch (cmd) {
  case 'boot':
    out(tb.renderBoot(project, 400))
    break
  case 'block': {
    const t = tb.renderBlockBody(project, args[1])
    out(t == null ? `没有块 ${args[1]}` : t)
    break
  }
  case 'children': {
    const t = tb.renderChildren(project, args[1])
    out(t == null ? `没有块 ${args[1]}` : t)
    break
  }
  case 'find':
    out(tb.renderFind(project, args.slice(1).join(' ')))
    break
  case 'check':
    out(tb.renderCheck(project))
    break
  case 'done': {
    if (args[1] == null || !/^[01]$/.test(args[2])) {
      console.error('用法：done <id> <0|1>')
      process.exit(2)
    }
    out(tb.setDone(project, args[1], Number(args[2])))
    break
  }
  case 'ids':
    out([...project.blocks.keys()].join('\n'))
    break
  case 'tokens': {
    const rows = []
    const boot = tb.renderBoot(project, 400)
    rows.push(['boot', tb.estimateTokens(boot)])
    let sum = tb.estimateTokens(boot)
    for (const id of project.blocks.keys()) {
      if (id === project.rootId) continue
      const t = tb.renderBlockBody(project, id) || ''
      const n = tb.estimateTokens(t)
      sum += n
      rows.push([`block ${id}`, n])
    }
    for (const [k, v] of rows) console.log(`${k.padEnd(14)} ${String(v).padStart(5)} tok`)
    console.log(`${'合计'.padEnd(13)} ${String(sum).padStart(5)} tok（boot + 每个块各读一次）`)
    let bytes = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else bytes += fs.statSync(p).size
      }
    }
    walk(rootDir)
    console.log(`流程图文件原始字节 ${bytes} B，块数 ${project.blocks.size}`)
    break
  }
  default:
    console.error('用法：node packages/tbfd/cli.mjs <boot|block|children|find|check|done|tokens|ids> [参数] [--project <目录>]')
    process.exit(2)
}
