// Runs the Tauri CLI. `tauri dev` is always the development build, "Tracket Dev": its own identifier and icon
// (src-tauri/tauri.dev.conf.json), so it runs next to the installed app and can't be mistaken for it.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js')
const args = process.argv.slice(2)
if (args[0] === 'dev') args.push('--config', 'src-tauri/tauri.dev.conf.json')

const { status } = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
process.exit(status ?? 1)
