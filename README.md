# Tracket

A lightweight desktop client for Jira Cloud. Browse and search tickets, move them through their workflow,
edit them in bulk, track time and post worklogs, and start working on a ticket in a fresh git worktree.

Windows only for now (the installer is built with NSIS and the app relies on WebView2).

Website: <https://hydhen.github.io/tracket-site/>, which lives in its own repository,
[Hydhen/tracket-site](https://github.com/Hydhen/tracket-site). This repository contains the application only.

## Install

Download `Tracket_<version>_x64-setup.exe` from the [latest release](https://github.com/Hydhen/tracket/releases/latest)
and run it. The installer isn't code-signed yet, so Windows SmartScreen may warn about an unknown publisher: choose
**More info**, then **Run anyway**.

Tracket then keeps itself up to date: it offers new versions inside the app, and every update is signed and verified
before it is installed (Settings > About lets you check by hand, or turn the check off).

## Getting started

1. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Start Tracket and enter your Jira site (`acme` or `acme.atlassian.net`), your Atlassian email and the token.

Tracket only ever talks to the Jira site you sign in to.

### "Start working" (optional)

For a ticket, Tracket can create a git worktree named after it (`<repo>/.claude/worktrees/<KEY>`, on a branch
named `<KEY>`) and open it in:

- **VS Code**, which needs the `code` command on your `PATH`;
- **herdr**, which opens a space that runs [Claude Code](https://claude.com/claude-code) (the `claude` command)
  with the ticket as its first message. If a space is already open there, it is shown, and Claude Code is
  started in a first tab when it isn't running yet.

You link each Jira project to a local repository in Settings > Quick start. Git must be installed.

## Your data

Tracket is built so you can check what it does with your data.

| What | Where it lives | Who sees it |
| --- | --- | --- |
| Jira API token, email, site | System keychain (Windows Credential Manager) | Only the Rust side of the app. The interface never gets the token, and it is only sent to your Jira site. |
| Timers, settings, folders linked to projects, which tickets are expanded | The app's local storage, in `%LOCALAPPDATA%\com.tracket.app` | Only on this computer. It holds ticket keys, field names and choices and folder paths, never ticket titles or descriptions. |
| Ticket content (titles, descriptions, comments, attachments) | Fetched from Jira when displayed, kept in memory | Attachments and images are marked `no-store`, so they are not written to disk. |
| The prompt for Claude Code | Passed as a command-line argument to `herdr-app` | The ticket key, title and link. It is visible in this computer's process list while the command starts, then goes to Claude Code, which has its own data policy. Only when you use herdr. |

- **No telemetry.** There is no analytics and no crash reporting. The network destinations are your Jira site
  (plus the avatar and image hosts Atlassian serves from) and github.com, to look for updates.
- **Update checks** ask `github.com/Hydhen/tracket` for the latest release, once when the app starts. GitHub sees
  your IP address, like any web request. Nothing about you or your Jira is sent. Turn it off in Settings > About.
- **Signing out erases everything.** Settings > Account > Sign out removes the token from the keychain and wipes
  all of the app's local storage (settings, timers, linked folders, cached pages). It warns you first if some
  timers hold time that was never posted as a worklog.
- To remove all traces after uninstalling, delete `%LOCALAPPDATA%\com.tracket.app` too.

### Security notes

- A strict Content Security Policy is set (`src-tauri/tauri.conf.json`): scripts only from the app itself, no
  frames, no forms, no network requests from the interface.
- Jira HTML is sanitised with DOMPurify. Images from your Jira site are loaded through a small proxy inside the
  app that only forwards `GET` requests to a fixed list of Jira paths, on the site you signed in to.
- API requests use Basic auth with your token, over HTTPS only (an `http://` site is refused).

Found a vulnerability? Please report it privately rather than in a public issue.

## Development

Requirements: Node.js, Rust (1.90 or newer) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # produce the installer
npm run lint           # oxlint
cargo test --manifest-path src-tauri/Cargo.toml
```

Stack: Tauri 2 (Rust), React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand.

### Release notes: changesets

The notes on the release page are written as the work happens, with [Changesets](https://github.com/changesets/changesets).
Every pull request that changes the app adds a changeset, a small file in `.changeset/` that says what changed in a
sentence its users would understand:

```bash
npm run changeset            # pick minor for a feature, patch for a fix, then describe it
npm run changeset -- --empty # for a change nobody will notice (docs, CI, refactor)
```

Commit the file with the change; it survives a squash merge. A check on the pull request fails without one when the
app's code changed.

### Releasing

Releases are automatic.

1. On every push to `main`, the **Changesets** workflow gathers the changesets that have landed into a **Release the
   next version** pull request, and keeps it up to date. It raises the version in `package.json`,
   `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and writes `CHANGELOG.md`.
2. Merging that pull request is the release. The **Release** workflow sees a version that has no tag yet, lints and
   tests, then builds and signs the installer, publishes `v<version>` with the changelog as its notes, and checks that
   the release has the installer, its signature and a valid `latest.json`.
3. Installed apps pick the update up from that `latest.json`.

Any other push to `main` releases nothing, since its version is already tagged. You can also run the **Release**
workflow by hand from the **Actions** tab.

Updates are signed with a key kept outside the repository. The public half is in `src-tauri/tauri.conf.json`; the
private half and its password are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Keep a backup of that key**: apps already installed accept updates signed
by it only, so losing it means everyone has to reinstall by hand.

## Third-party notices

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
