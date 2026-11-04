// Changesets raises the version in package.json only. The app has the same version in two more
// places (and in the lockfiles), and the release workflow refuses a release where they disagree.
import { readFileSync, writeFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

function rewrite(path, replace) {
  const before = readFileSync(path, 'utf8')
  const after = replace(before)
  if (after === before) return
  writeFileSync(path, after)
  console.log(`${path} -> ${version}`)
}

// Only the first "version" key: the one of the config itself, not of a plugin
rewrite('src-tauri/tauri.conf.json', (s) => s.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`))

// Only the [package] table's own version, not a dependency's
rewrite('src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`))

// The lockfile entry of the app itself, so `cargo build` has nothing to change
rewrite('src-tauri/Cargo.lock', (s) => s.replace(/(name = "tracket"\r?\nversion = ")[^"]+(")/, `$1${version}$2`))

// The same for npm
rewrite('package-lock.json', (s) => {
  const lock = JSON.parse(s)
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  return JSON.stringify(lock, null, 2) + '\n'
})
