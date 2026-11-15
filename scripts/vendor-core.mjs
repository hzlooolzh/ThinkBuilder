#!/usr/bin/env node
// 把 packages/core/index.mjs 复制成编辑器插件的 ./core.mjs。
// 插件是独立安装包（DSH 会把它拷进 profile），不能 import 工作区里的相对路径，所以单文件内置。
// 改了 core 就重跑：node scripts/vendor-core.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'packages', 'core', 'index.mjs')
const dest = path.join(root, 'packages', 'editor-ui', 'core.mjs')
const banner = '// 自动生成，不要手改：由 scripts/vendor-core.mjs 从 packages/core/index.mjs 复制。\n'
fs.writeFileSync(dest, banner + fs.readFileSync(src, 'utf8'), 'utf8')
console.log(`core.mjs 已更新：${path.relative(root, dest)}`)
