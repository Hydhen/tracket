//! Setting up a place to work on a ticket: a git worktree named after it, opened in VS Code or herdr.
//!
//! Git is run as a child process (never through a shell), with prompts disabled so a missing
//! credential fails instead of hanging the app.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Root of the main working tree
    root: String,
    /// What new branches start from, e.g. `origin/main`
    base_ref: String,
    /// Where the folder given sits in the repository (`packages/api`), empty at its root
    subpath: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    /// The worktree itself: the whole repository, on the ticket's branch
    path: String,
    /// What to open: the project's folder inside the worktree (the worktree when it is the repository's root)
    folder: String,
    /// False when it already existed and was reused
    created: bool,
}

/// What a folder given as a project's root turned out to be.
struct Inspected {
    root: PathBuf,
    base_ref: String,
    subpath: String,
}

/// The project's folder inside a worktree, or the worktree when the branch doesn't have it.
fn folder_in(worktree: &Path, subpath: &str) -> PathBuf {
    let inside = worktree.join(subpath);
    if !subpath.is_empty() && inside.is_dir() {
        inside
    } else {
        worktree.to_path_buf()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HerdrLaunch {
    /// False when herdr started Claude Code but couldn't hand it the prompt, or when nothing was
    /// started because the worktree already had a space running Claude Code (see `already_open`)
    prompt_sent: bool,
    /// True when the worktree already had a space with Claude Code running in it: it was brought
    /// to the front, and nothing was started nor sent. A space without Claude Code gets a tab that
    /// runs it, as its first one (so this is false), but no second space is made
    already_open: bool,
}

/// `ABC-123`: branch names and folder names are built from it, so nothing else gets through.
pub(crate) fn valid_issue_key(key: &str) -> bool {
    let Some((project, number)) = key.split_once('-') else {
        return false;
    };
    project
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_uppercase())
        && project
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
}

fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up
        command.creation_flags(0x0800_0000);
    }
    command
}

fn git(dir: &Path, args: &[&str]) -> std::result::Result<String, String> {
    let output = command("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("Couldn't run git ({e}). Is it installed and on the PATH?"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            format!("git {} failed", args.first().unwrap_or(&""))
        } else {
            message
        })
    }
}

fn git_error(message: String) -> AppError {
    AppError::new("git", message)
}

fn inspect(path: &str) -> Result<Inspected> {
    let dir = Path::new(path.trim());
    if !dir.is_dir() {
        return Err(AppError::new("invalidQuery", "That folder doesn't exist"));
    }

    // The common dir is the main repository's `.git`, also when `path` is one of its worktrees
    let common = git(
        dir,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .map_err(|_| AppError::new("git", "That folder isn't a git repository"))?;
    let common = PathBuf::from(common);
    let root: PathBuf = match (common.file_name(), common.parent()) {
        // Git prints forward slashes; rebuilding from components gives the platform's separators
        (Some(name), Some(parent)) if name == ".git" => parent.components().collect::<PathBuf>(),
        _ => return Err(AppError::new("git", "Bare repositories aren't supported")),
    };

    // origin/HEAD says which branch is the default one; fall back to the usual names
    let base_ref = git(&root, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .ok()
        .or_else(|| {
            ["origin/main", "origin/master"].into_iter().find_map(|candidate| {
                git(&root, &["rev-parse", "--verify", "--quiet", candidate])
                    .ok()
                    .map(|_| candidate.to_string())
            })
        })
        .ok_or_else(|| {
            AppError::new(
                "git",
                "Couldn't find the default branch of origin. Try `git remote set-head origin -a` in that repository",
            )
        })?;

    // Where `dir` is inside its working tree: "" at the top, "packages/api/" in a monorepo
    let subpath = git(dir, &["rev-parse", "--show-prefix"])
        .map_err(git_error)?
        .trim_end_matches('/')
        .to_string();

    Ok(Inspected {
        root,
        base_ref,
        subpath,
    })
}

/// Checks that `path` is (inside) a git repository and tells where its main working tree is.
#[tauri::command]
pub async fn check_repo(path: String) -> Result<RepoInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        let found = inspect(&path)?;
        Ok(RepoInfo {
            root: found.root.to_string_lossy().into_owned(),
            base_ref: found.base_ref,
            subpath: found.subpath,
        })
    })
    .await
    .map_err(|e| AppError::new("unexpected", e.to_string()))?
}

/// What to do when the ticket's usual worktree location can't simply be used (see `plan_worktree`).
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorktreeStrategy {
    /// Use what is there: the worktree the branch is checked out in, else the folder as it is
    Reuse,
    /// Remove what is there, then create the worktree at its usual place
    Replace,
    /// Create it under `base`, as `<base>/<repo>/<key>`
    Elsewhere { base: String },
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorktreeOutcome {
    Ready { worktree: Worktree },
    /// Nothing was changed: the user is asked what to do (see `WorktreeStrategy`)
    Conflict { conflict: WorktreeConflict },
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    /// The usual folder exists, but git doesn't know it as a worktree: what a removal left behind
    Leftover,
    /// The branch is already checked out in a worktree somewhere else
    BranchElsewhere,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeConflict {
    kind: ConflictKind,
    /// The usual location, `<repo>/.claude/worktrees/<key>`
    path: String,
    /// Where git has the branch checked out, when it does
    registered_at: Option<String>,
    /// A few names of what is in the usual folder, when it exists
    leftover: Vec<String>,
    /// Why "replace" can't be done, when it can't
    replace_blocked: Option<String>,
    /// Why "elsewhere" can't be done, when it can't
    elsewhere_blocked: Option<String>,
}

/// Where the user's own folders for worktrees are proposed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeBases {
    herdr: String,
    tracket: String,
}

/// A worktree git knows about, out of `git worktree list --porcelain`.
#[derive(Debug, Clone, PartialEq)]
struct Registered {
    path: PathBuf,
    /// None when detached
    branch: Option<String>,
}

fn parse_worktrees(listing: &str) -> Vec<Registered> {
    let mut found = Vec::new();
    for block in listing.replace("\r\n", "\n").split("\n\n") {
        let mut path = None;
        let mut branch = None;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(PathBuf::from(p));
            } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
                branch = Some(b.to_string());
            }
        }
        if let Some(path) = path {
            found.push(Registered { path, branch });
        }
    }
    found
}

/// Whether two paths are the same place: as the system resolves them when they exist (short
/// names, links), else as written.
fn same_place(a: &Path, b: &Path) -> bool {
    let key = |path: &Path| {
        let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        comparable_folder(&resolved.to_string_lossy())
    };
    key(a) == key(b)
}

#[derive(Debug, PartialEq)]
enum Plan {
    /// Git has a worktree at the usual place
    Ready,
    /// Nothing is in the way
    Create,
    Conflict {
        kind: ConflictKind,
        branch_at: Option<PathBuf>,
        leftover: bool,
    },
}

/// What the usual location of the ticket's worktree is up against. A folder only counts as the
/// worktree when git lists it: one that merely exists is what a removal left behind. A branch
/// checked out elsewhere can't be checked out again, so that is in the way too.
fn plan_worktree(registered: &[Registered], usual: &Path, key: &str, usual_exists: bool) -> Plan {
    if registered.iter().any(|r| same_place(&r.path, usual)) {
        return Plan::Ready;
    }
    let branch_at = registered
        .iter()
        .find(|r| r.branch.as_deref() == Some(key))
        .map(|r| r.path.clone());
    match (branch_at, usual_exists) {
        (None, false) => Plan::Create,
        (None, true) => Plan::Conflict {
            kind: ConflictKind::Leftover,
            branch_at: None,
            leftover: true,
        },
        (Some(at), exists) => Plan::Conflict {
            kind: ConflictKind::BranchElsewhere,
            branch_at: Some(at),
            leftover: exists,
        },
    }
}

/// `<base>/<repo>/<key>`
fn elsewhere_target(base: &str, repo: &str, key: &str) -> std::result::Result<PathBuf, AppError> {
    let base = Path::new(base.trim());
    if !base.is_absolute() {
        return Err(AppError::new(
            "invalidQuery",
            "Pick a full folder path for the worktrees",
        ));
    }
    Ok(base.join(repo).join(key))
}

fn is_empty_dir(path: &Path) -> bool {
    std::fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
}

/// The first few names in a folder, sorted.
fn names_in(path: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names.truncate(6);
    names
}

fn has_uncommitted_changes(worktree: &Path) -> bool {
    git(worktree, &["status", "--porcelain"]).is_ok_and(|status| !status.is_empty())
}

fn replace_blocked(root: &Path, branch_at: Option<&Path>) -> Option<String> {
    let at = branch_at?;
    if same_place(at, root) {
        Some("The branch is checked out in the repository's own working tree".to_string())
    } else if at.is_dir() && has_uncommitted_changes(at) {
        Some(format!(
            "{} has uncommitted changes: commit or discard them first",
            at.display()
        ))
    } else {
        None
    }
}

fn elsewhere_blocked(key: &str, branch_at: Option<&Path>) -> Option<String> {
    branch_at.map(|at| {
        format!(
            "The branch {key} is checked out in {}: reuse that worktree, or replace it",
            at.display()
        )
    })
}

/// The worktree on branch `key` at `location`, from what origin has now (offline is fine: the
/// local copy of the branch is used).
fn add_worktree(root: &Path, base_ref: &str, key: &str, location: &Path) -> Result<()> {
    let _ = git(root, &["fetch", "origin"]);

    let location = location.to_string_lossy();
    let branch_exists = git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{key}"),
        ],
    )
    .is_ok();
    let added = if branch_exists {
        git(root, &["worktree", "add", &location, key])
    } else {
        // Not tracking the default branch: the ticket branch gets pushed under its own name
        git(
            root,
            &[
                "worktree",
                "add",
                "--no-track",
                "-b",
                key,
                &location,
                base_ref,
            ],
        )
    };
    added.map(drop).map_err(git_error)
}

/// Removes a folder that git doesn't know as a worktree. Links inside it are removed, not followed.
fn remove_leftover(usual: &Path) -> Result<()> {
    let is_link = std::fs::symlink_metadata(usual).is_ok_and(|m| m.file_type().is_symlink());
    if is_link {
        return Err(AppError::new(
            "git",
            format!("{} is a link: remove it by hand", usual.display()),
        ));
    }
    std::fs::remove_dir_all(usual).map_err(|e| {
        AppError::new(
            "git",
            format!(
                "Couldn't remove {} ({e}). Is something using it?",
                usual.display()
            ),
        )
    })
}

fn prepare_worktree(
    inspected: &Inspected,
    key: &str,
    strategy: Option<WorktreeStrategy>,
) -> Result<WorktreeOutcome> {
    let Inspected {
        root,
        base_ref,
        subpath,
    } = inspected;
    let ready = |path: &Path, created| WorktreeOutcome::Ready {
        worktree: Worktree {
            path: path.to_string_lossy().into_owned(),
            folder: folder_in(path, subpath).to_string_lossy().into_owned(),
            created,
        },
    };

    let usual = root.join(".claude").join("worktrees").join(key);
    let listing = git(root, &["worktree", "list", "--porcelain"]).map_err(git_error)?;
    let registered = parse_worktrees(&listing);

    let (kind, branch_at, leftover) = match plan_worktree(&registered, &usual, key, usual.exists())
    {
        Plan::Ready => return Ok(ready(&usual, false)),
        Plan::Create => {
            add_worktree(root, base_ref, key, &usual)?;
            return Ok(ready(&usual, true));
        }
        Plan::Conflict {
            kind,
            branch_at,
            leftover,
        } => (kind, branch_at, leftover),
    };

    let blocked_replace = replace_blocked(root, branch_at.as_deref());
    let blocked_elsewhere = elsewhere_blocked(key, branch_at.as_deref());

    match strategy {
        None => Ok(WorktreeOutcome::Conflict {
            conflict: WorktreeConflict {
                kind,
                path: usual.to_string_lossy().into_owned(),
                registered_at: branch_at.map(|p| p.to_string_lossy().into_owned()),
                leftover: if leftover { names_in(&usual) } else { Vec::new() },
                replace_blocked: blocked_replace,
                elsewhere_blocked: blocked_elsewhere,
            },
        }),
        Some(WorktreeStrategy::Reuse) => Ok(ready(branch_at.as_deref().unwrap_or(&usual), false)),
        Some(WorktreeStrategy::Replace) => {
            if let Some(why) = blocked_replace {
                return Err(AppError::new("git", why));
            }
            if let Some(at) = branch_at.as_deref().filter(|at| at.is_dir()) {
                // Checked clean just above, so nothing of the user's is lost
                git(
                    root,
                    &["worktree", "remove", "--force", &at.to_string_lossy()],
                )
                .map_err(git_error)?;
            }
            if leftover && usual.exists() {
                remove_leftover(&usual)?;
            }
            // Registrations whose folder is gone would still hold the branch
            git(root, &["worktree", "prune"]).map_err(git_error)?;
            add_worktree(root, base_ref, key, &usual)?;
            Ok(ready(&usual, true))
        }
        Some(WorktreeStrategy::Elsewhere { base }) => {
            let repo = root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "repo".to_string());
            let target = elsewhere_target(&base, &repo, key)?;
            if registered.iter().any(|r| same_place(&r.path, &target)) {
                return Ok(ready(&target, false));
            }
            if let Some(why) = blocked_elsewhere {
                return Err(AppError::new("git", why));
            }
            if target.exists() && !is_empty_dir(&target) {
                return Err(AppError::new(
                    "git",
                    format!(
                        "{} already exists and isn't a worktree of this repository",
                        target.display()
                    ),
                ));
            }
            add_worktree(root, base_ref, key, &target)?;
            Ok(ready(&target, true))
        }
    }
}

/// Makes the worktree `<repo>/.claude/worktrees/<key>` on a branch named exactly `<key>`,
/// starting from the default branch of origin. A worktree git already has there is reused as it
/// is. When something is in the way (a leftover folder, the branch checked out elsewhere) nothing
/// is touched and the conflict is returned, unless a `strategy` says what to do about it. `repo`
/// is the project's root folder: the repository itself, or a folder inside it (a monorepo's package).
#[tauri::command]
pub async fn create_worktree(
    repo: String,
    key: String,
    strategy: Option<WorktreeStrategy>,
) -> Result<WorktreeOutcome> {
    if !valid_issue_key(&key) {
        return Err(AppError::new("invalidQuery", "Invalid issue key"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let inspected = inspect(&repo)?;
        prepare_worktree(&inspected, &key, strategy)
    })
    .await
    .map_err(|e| AppError::new("unexpected", e.to_string()))?
}

/// Where "create in your user folder" proposes to put worktrees: herdr's own folder for them
/// (where it puts its own), and one of Tracket's for the other apps.
#[tauri::command]
pub fn worktree_bases() -> Result<WorktreeBases> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| AppError::new("unexpected", "Couldn't find your user folder"))?;
    let under = |app: &str| {
        home.join(app)
            .join("worktrees")
            .to_string_lossy()
            .into_owned()
    };
    Ok(WorktreeBases {
        herdr: under(".herdr"),
        tracket: under(".tracket"),
    })
}

/// Opens `path` in VS Code (a new window, or the one that already has it).
#[tauri::command]
pub async fn open_in_vscode(path: String) -> Result<()> {
    if !Path::new(&path).is_dir() {
        return Err(AppError::new("invalidQuery", "That folder doesn't exist"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let output = command("code.cmd").arg(&path).output().map_err(|_| {
            AppError::new(
                "vscode",
                "Couldn't run the `code` command. In VS Code, run \"Shell Command: Install 'code' command in PATH\"",
            )
        })?;
        if output.status.success() {
            Ok(())
        } else {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(AppError::new(
                "vscode",
                format!("VS Code didn't open: {message}"),
            ))
        }
    })
    .await
    .map_err(|e| AppError::new("unexpected", e.to_string()))?
}

/// The `herdr-app` command: on the PATH when it is there, else where its installer puts it.
fn herdr_program() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| {
            PathBuf::from(base)
                .join("Programs")
                .join("herdr-app")
                .join("herdr-app.exe")
        })
        .filter(|installed| installed.is_file())
        .unwrap_or_else(|| PathBuf::from("herdr-app"))
}

/// The id of the tab `herdr-app do tab.new` made, out of what it printed.
fn made_tab(stdout: &str) -> Option<String> {
    let printed = serde_json::from_str::<serde_json::Value>(stdout.trim()).ok()?;
    let tab = printed.get("tab")?;
    tab.as_str()
        .or_else(|| tab.get("id")?.as_str())
        .map(str::to_string)
}

/// What `herdr-app do` printed: whether the prompt reached Claude Code, or why the command failed.
/// It prints what it made as JSON, or `{ "error": "..." }`.
fn herdr_outcome(stdout: &str) -> std::result::Result<bool, String> {
    let Ok(printed) = serde_json::from_str::<serde_json::Value>(stdout.trim()) else {
        // Nothing to read, so nothing says the prompt was lost
        return Ok(true);
    };
    if let Some(error) = printed.get("error") {
        return Err(error
            .as_str()
            .map_or_else(|| error.to_string(), str::to_string));
    }
    // Looked for at the top and one level down, since where it is reported isn't documented
    let sent = printed
        .get("first_message")
        .or_else(|| printed.get("terminal")?.get("first_message"))
        .and_then(|message| message.get("sent"))
        .and_then(serde_json::Value::as_bool);
    Ok(sent != Some(false))
}

/// Whether herdr's window is open and answering (the commands talk to it).
fn herdr_answers(program: &Path) -> bool {
    command(&program.to_string_lossy())
        .arg("status")
        .output()
        .is_ok_and(|output| output.status.success())
}

/// Opens herdr's window as a process of its own: it has to outlive this command.
fn start_herdr_window(program: &Path) -> std::result::Result<(), AppError> {
    let mut window = Command::new(program);
    window
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Its own process group and no console
        window.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    window.spawn().map(drop).map_err(|_| {
        AppError::new(
            "herdr",
            "Couldn't run the `herdr-app` command. Is herdr installed?",
        )
    })
}

/// How often, and how long apart, a window that is starting is asked whether it answers.
const WINDOW_POLLS: u32 = 60;
const WINDOW_POLL_EVERY: std::time::Duration = std::time::Duration::from_millis(500);

/// A window that already answers is used as it is; otherwise `start` opens one and it is asked
/// every so often until it answers. True when this call opened it.
fn ensure_window(
    mut answers: impl FnMut() -> bool,
    start: impl FnOnce() -> std::result::Result<(), AppError>,
    mut pause: impl FnMut(),
    polls: u32,
) -> std::result::Result<bool, AppError> {
    if answers() {
        return Ok(false);
    }
    start()?;
    for _ in 0..polls {
        pause();
        if answers() {
            return Ok(true);
        }
    }
    Err(AppError::new("herdr", "herdr's window didn't open in time"))
}

/// How many times a command is tried on a window that has only just opened: it may need a moment
/// before it takes commands. One already open is tried once, since it isn't waiting for anything.
fn launch_tries(just_opened: bool) -> u32 {
    if just_opened { 5 } else { 1 }
}

/// Runs `attempt` until it works or the tries are used up, with `pause` between them.
fn launch_with_retries(
    just_opened: bool,
    mut attempt: impl FnMut() -> std::result::Result<bool, String>,
    mut pause: impl FnMut(),
) -> std::result::Result<bool, String> {
    let mut last = String::new();
    for n in 0..launch_tries(just_opened) {
        if n > 0 {
            pause();
        }
        match attempt() {
            Ok(sent) => return Ok(sent),
            Err(why) => last = why,
        }
    }
    Err(last)
}

/// A folder written so that two spellings of the same place compare equal: Windows paths ignore
/// case, take either slash and may carry the `\\?\` prefix or a trailing separator.
fn comparable_folder(folder: &str) -> String {
    let folder = folder.strip_prefix(r"\\?\").unwrap_or(folder);
    folder
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// A space already open in a folder.
#[derive(Debug, PartialEq)]
struct OpenSpace {
    id: String,
    /// Whether one of its terminals runs Claude Code (an agent working under it doesn't count)
    has_claude: bool,
}

/// The space on this computer that is open in `folder`, out of what `herdr-app ls` printed.
/// Spaces on another machine are left out: their folders are paths over there.
fn find_space(listing: &str, folder: &str) -> Option<OpenSpace> {
    let wanted = comparable_folder(folder);
    let listing = serde_json::from_str::<serde_json::Value>(listing.trim()).ok()?;
    let space = listing
        .get("spaces")?
        .as_array()?
        .iter()
        .filter(|space| space.get("machine").is_none_or(serde_json::Value::is_null))
        .find(|space| {
            space
                .get("folder")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|open_in| comparable_folder(open_in) == wanted)
        })?;
    let has_claude = space
        .get("tabs")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tab| tab.get("terminals")?.as_array())
        .flatten()
        .any(|terminal| {
            terminal.get("app").and_then(serde_json::Value::as_str) == Some("claude-code")
        });
    Some(OpenSpace {
        id: space.get("id")?.as_str()?.to_string(),
        has_claude,
    })
}

/// The space already open in `folder`, if herdr says there is one. A listing that can't be had
/// counts as none: the worst that happens is the space gets made as it always was.
fn herdr_open_space(program: &Path, folder: &str) -> Option<OpenSpace> {
    let output = command(&program.to_string_lossy()).arg("ls").output().ok()?;
    if !output.status.success() {
        return None;
    }
    find_space(&String::from_utf8_lossy(&output.stdout), folder)
}

/// One try at a `herdr-app do` command: what it printed and whether the prompt reached Claude Code
/// (true when it had none to send), or why it failed.
fn herdr_do(program: &Path, args: &[&str]) -> std::result::Result<(String, bool), String> {
    let output = command(&program.to_string_lossy())
        .arg("do")
        .args(args)
        .output()
        .map_err(|_| "Couldn't run the `herdr-app` command. Is herdr installed?".to_string())?;

    // A failure is `{ "error": "..." }` and/or a failing exit status
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let sent = herdr_outcome(&stdout)?;
    if output.status.success() {
        Ok((stdout, sent))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "the command failed".to_string()
        } else {
            stderr
        })
    }
}

/// One try at showing a space that is already open: nothing to read back but whether it worked.
fn herdr_select(program: &Path, space: &str) -> std::result::Result<(), String> {
    herdr_do(program, &["space.select", "--id", space]).map(drop)
}

/// One try at making the space: whether the prompt was sent, or why it failed.
fn herdr_space(
    program: &Path,
    name: &str,
    folder: &str,
    prompt: &str,
) -> std::result::Result<bool, String> {
    let args = [
        "space.new", "--name", name, "--folder", folder, "--argv", r#"["claude"]"#, "--task", prompt,
    ];
    herdr_do(program, &args).map(|(_, sent)| sent)
}

/// One try at showing a space and starting Claude Code in a tab of its own there, put first among
/// the space's tabs: whether the prompt was sent, or why it failed.
fn herdr_claude_in_space(
    program: &Path,
    space: &str,
    folder: &str,
    prompt: &str,
) -> std::result::Result<bool, String> {
    herdr_select(program, space)?;
    let args = [
        "tab.new", "--space", space, "--folder", folder, "--argv", r#"["claude"]"#, "--task", prompt,
    ];
    let (printed, sent) = herdr_do(program, &args)?;

    // Only a nicety: the tab exists and Claude runs in it, and trying again would start a second one
    if let Some(tab) = made_tab(&printed) {
        let _ = herdr_do(program, &["tab.move", "--id", &tab, "--index", "1"]);
    }
    Ok(sent)
}

/// Opens a herdr space named `name` in `folder` that runs Claude Code with `prompt` as its first
/// message. The window is opened first when it isn't already. When a space is already open in
/// `folder` no second one is made: it is brought to the front, and when Claude Code isn't running
/// in it a first tab is added that starts it with the prompt. With Claude Code already there, the
/// prompt isn't sent again.
#[tauri::command]
pub async fn open_in_herdr(folder: String, name: String, prompt: String) -> Result<HerdrLaunch> {
    if !valid_issue_key(&name) {
        return Err(AppError::new("invalidQuery", "Invalid issue key"));
    }
    if !Path::new(&folder).is_dir() {
        return Err(AppError::new("invalidQuery", "That folder doesn't exist"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let program = herdr_program();
        let just_opened = ensure_window(
            || herdr_answers(&program),
            || start_herdr_window(&program),
            || std::thread::sleep(WINDOW_POLL_EVERY),
            WINDOW_POLLS,
        )?;

        let pause = || std::thread::sleep(std::time::Duration::from_secs(1));

        if let Some(space) = herdr_open_space(&program, &folder) {
            if space.has_claude {
                return launch_with_retries(
                    just_opened,
                    || herdr_select(&program, &space.id).map(|()| true),
                    pause,
                )
                .map(|_| HerdrLaunch {
                    prompt_sent: false,
                    already_open: true,
                })
                .map_err(|why| {
                    AppError::new("herdr", format!("herdr couldn't show the space: {why}"))
                });
            }

            // The space is there but Claude Code isn't: start it in the space instead of a new one
            return launch_with_retries(
                just_opened,
                || herdr_claude_in_space(&program, &space.id, &folder, &prompt),
                pause,
            )
            .map(|prompt_sent| HerdrLaunch {
                prompt_sent,
                already_open: false,
            })
            .map_err(|why| {
                AppError::new(
                    "herdr",
                    format!("herdr couldn't start Claude Code in the space: {why}"),
                )
            });
        }

        launch_with_retries(
            just_opened,
            || herdr_space(&program, &name, &folder, &prompt),
            pause,
        )
        .map(|prompt_sent| HerdrLaunch {
            prompt_sent,
            already_open: false,
        })
        .map_err(|why| AppError::new("herdr", format!("herdr didn't open: {why}")))
    })
    .await
    .map_err(|e| AppError::new("unexpected", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::{
        OpenSpace, WINDOW_POLL_EVERY, WINDOW_POLLS, ensure_window, find_space, folder_in,
        herdr_answers, herdr_outcome, herdr_program, launch_with_retries, made_tab,
        start_herdr_window, valid_issue_key,
    };
    use crate::error::AppError;

    const LISTING: &str = r#"{
      "spaces": [
        { "id": "sp-home", "name": "Home", "folder": "C:\\Users\\jane", "machine": null,
          "tabs": [{ "terminals": [{ "terminal": "t1", "app": null, "sub_agents": [] }] }] },
        { "id": "sp-main", "name": "App", "folder": "C:\\dev\\app", "machine": null,
          "tabs": [{ "terminals": [{ "terminal": "t7", "app": "claude-code", "sub_agents": [] }] }] },
        { "id": "sp-es1", "name": "ABC-1", "folder": "C:\\dev\\repo\\.claude\\worktrees\\ABC-1", "machine": null,
          "tabs": [{ "terminals": [{ "terminal": "t10", "app": null, "sub_agents": [] }] }] },
        { "id": "sp-es4", "name": "ABC-4", "folder": "C:\\dev\\repo\\.claude\\worktrees\\ABC-4", "machine": null,
          "tabs": [
            { "terminals": [{ "terminal": "t11", "app": null, "sub_agents": [] }] },
            { "terminals": [{ "terminal": "t12", "app": "claude-code", "sub_agents": [] }] }
          ] },
        { "id": "sp-remote", "name": "ABC-2", "folder": "C:\\dev\\repo\\.claude\\worktrees\\ABC-2", "machine": "box",
          "tabs": [] }
      ],
      "recent": []
    }"#;

    fn space(id: &str, has_claude: bool) -> Option<OpenSpace> {
        Some(OpenSpace {
            id: id.to_string(),
            has_claude,
        })
    }

    #[test]
    fn tells_whether_claude_code_runs_in_the_space() {
        // In its only terminal, in one tab among others, or in none
        assert_eq!(find_space(LISTING, r"C:\dev\app"), space("sp-main", true));
        assert_eq!(find_space(LISTING, r"C:\dev\repo\.claude\worktrees\ABC-4"), space("sp-es4", true));
        assert_eq!(find_space(LISTING, r"C:\Users\jane"), space("sp-home", false));

        // A space listed without tabs says nothing about Claude Code
        let bare = r#"{"spaces":[{"id":"s","folder":"C:\\a","machine":null}]}"#;
        assert_eq!(find_space(bare, r"C:\a"), space("s", false));
    }

    #[test]
    fn reads_the_tab_that_was_made() {
        assert_eq!(
            made_tab(r#"{"space":"sp1","tab":"tb1","terminal":"t2"}"#),
            Some("tb1".to_string())
        );
        assert_eq!(made_tab(r#"{"tab":{"id":"tb2"}}"#), Some("tb2".to_string()));
        assert_eq!(made_tab(r#"{"space":"sp1"}"#), None);
        assert_eq!(made_tab(""), None);
    }

    #[test]
    fn finds_the_space_already_open_in_a_worktree() {
        let es1 = r"C:\dev\repo\.claude\worktrees\ABC-1";
        assert_eq!(find_space(LISTING, es1), space("sp-es1", false));

        // The same place written another way: case, slashes, a trailing separator, the `\\?\` prefix
        for spelling in [
            r"c:\DEV\repo\.claude\worktrees\abc-1",
            "C:/dev/repo/.claude/worktrees/ABC-1",
            r"C:\dev\repo\.claude\worktrees\ABC-1\",
            r"\\?\C:\dev\repo\.claude\worktrees\ABC-1",
        ] {
            assert_eq!(find_space(LISTING, spelling), space("sp-es1", false));
        }
    }

    #[test]
    fn a_folder_nothing_is_open_in_finds_no_space() {
        // Not a folder that is open, nor a parent or a child of one
        assert_eq!(find_space(LISTING, r"C:\dev\repo\.claude\worktrees\ABC-3"), None);
        assert_eq!(find_space(LISTING, r"C:\dev\repo\.claude\worktrees\ABC-1\src"), None);
        assert_eq!(find_space(LISTING, r"C:\dev\repo"), None);
        // Another machine's space isn't this computer's folder, even with the same path
        assert_eq!(find_space(LISTING, r"C:\dev\repo\.claude\worktrees\ABC-2"), None);
        // A listing that can't be read, or has no spaces, finds nothing: the space gets made
        assert_eq!(find_space("", r"C:\dev"), None);
        assert_eq!(find_space("not json", r"C:\dev"), None);
        assert_eq!(find_space(r#"{"error":"no window"}"#, r"C:\dev"), None);
    }

    #[test]
    fn reads_what_herdr_says_about_the_launch() {
        // What it made, with nothing about the message: nothing says it was lost
        assert_eq!(
            herdr_outcome(r#"{"space":"sp1","tab":"tb1","terminal":"t2"}"#),
            Ok(true)
        );
        assert_eq!(
            herdr_outcome(r#"{"first_message":{"sent":true}}"#),
            Ok(true)
        );
        assert_eq!(
            herdr_outcome(r#"{"terminal":{"first_message":{"sent":false}}}"#),
            Ok(false)
        );
        assert_eq!(
            herdr_outcome(r#"{"first_message":{"sent":false}}"#),
            Ok(false)
        );
        assert_eq!(
            herdr_outcome(r#"{"error":"unknown argument"}"#),
            Err("unknown argument".to_string())
        );
        assert_eq!(herdr_outcome(""), Ok(true));
    }

    #[test]
    fn a_window_that_is_already_open_is_used_without_starting_another() {
        let started = Cell::new(0);
        let asked = Cell::new(0);
        let opened = ensure_window(
            || {
                asked.set(asked.get() + 1);
                true
            },
            || {
                started.set(started.get() + 1);
                Ok(())
            },
            || panic!("nothing to wait for"),
            10,
        );

        assert_eq!(opened.ok(), Some(false), "it wasn't opened by this call");
        assert_eq!(started.get(), 0, "no second window");
        assert_eq!(asked.get(), 1);
    }

    #[test]
    fn a_window_that_is_closed_is_started_and_waited_for() {
        let started = Cell::new(0);
        let waits = Cell::new(0);
        // Closed until it has been started and has had three pauses to come up
        let opened = ensure_window(
            || started.get() == 1 && waits.get() >= 3,
            || {
                started.set(started.get() + 1);
                Ok(())
            },
            || waits.set(waits.get() + 1),
            10,
        );

        assert_eq!(opened.ok(), Some(true), "this call opened it");
        assert_eq!(started.get(), 1, "started once, not once per poll");
        assert_eq!(waits.get(), 3);
    }

    #[test]
    fn a_window_that_never_answers_is_given_up_on() {
        let started = Cell::new(0);
        let waits = Cell::new(0);
        let opened = ensure_window(
            || false,
            || {
                started.set(started.get() + 1);
                Ok(())
            },
            || waits.set(waits.get() + 1),
            4,
        );

        assert!(opened.is_err());
        assert_eq!(started.get(), 1);
        assert_eq!(waits.get(), 4, "waited as long as it was allowed to");
    }

    #[test]
    fn a_window_that_cannot_be_started_is_not_waited_for() {
        let opened = ensure_window(
            || false,
            || Err(AppError::new("herdr", "not installed")),
            || panic!("no point waiting for what didn't start"),
            10,
        );

        assert!(opened.is_err());
    }

    #[test]
    fn a_window_that_just_opened_gets_a_few_tries_and_an_open_one_gets_one() {
        // Not ready for the first two commands, then fine
        let tries = Cell::new(0);
        let sent = launch_with_retries(
            true,
            || {
                tries.set(tries.get() + 1);
                if tries.get() < 3 {
                    Err("no layout yet".to_string())
                } else {
                    Ok(true)
                }
            },
            || {},
        );
        assert_eq!(sent, Ok(true));
        assert_eq!(tries.get(), 3);

        // A window that was already open failing is a real failure: said at once, not retried
        let tries = Cell::new(0);
        let sent = launch_with_retries(
            false,
            || {
                tries.set(tries.get() + 1);
                Err("unknown argument".to_string())
            },
            || panic!("no second try"),
        );
        assert_eq!(sent, Err("unknown argument".to_string()));
        assert_eq!(tries.get(), 1);

        // A new window that never takes commands ends with the last thing it said
        let sent = launch_with_retries(true, || Err("still starting".to_string()), || {});
        assert_eq!(sent, Err("still starting".to_string()));
    }

    /// Against the herdr that is installed here, so it opens a window: run it by hand with
    /// `cargo test real_herdr -- --ignored`. Whether the window was open before or not, the first
    /// call leaves one answering, and the second finds it and starts nothing more.
    #[test]
    #[ignore = "opens the herdr window"]
    fn real_herdr_is_started_when_closed_and_reused_when_open() {
        let program = herdr_program();
        assert!(program.is_file(), "herdr isn't installed at {program:?}");

        let ensure = || {
            ensure_window(
                || herdr_answers(&program),
                || start_herdr_window(&program),
                || std::thread::sleep(WINDOW_POLL_EVERY),
                WINDOW_POLLS,
            )
        };

        let first = ensure().expect("herdr's window should open");
        println!(
            "window was {}",
            if first {
                "closed: started it"
            } else {
                "already open"
            }
        );
        assert!(herdr_answers(&program), "it answers once ensured");

        assert_eq!(
            ensure().ok(),
            Some(false),
            "the open window is reused, not started again"
        );
    }

    #[test]
    fn opens_the_projects_folder_inside_the_worktree() {
        let worktree = std::env::temp_dir().join(format!("tracket-test-{}", std::process::id()));
        let package = worktree.join("packages").join("api");
        std::fs::create_dir_all(&package).unwrap();

        assert_eq!(folder_in(&worktree, "packages/api"), package);
        // At the repository's root, or when the branch doesn't have the folder: the worktree itself
        assert_eq!(folder_in(&worktree, ""), worktree);
        assert_eq!(folder_in(&worktree, "packages/gone"), worktree);

        std::fs::remove_dir_all(&worktree).unwrap();
    }

    #[test]
    fn only_real_issue_keys_become_branch_names() {
        assert!(valid_issue_key("ABC-20741"));
        assert!(valid_issue_key("AB_C1-7"));
        assert!(!valid_issue_key("-x"));
        assert!(!valid_issue_key("--force-1"));
        assert!(!valid_issue_key("abc-1"));
        assert!(!valid_issue_key("ES-"));
        assert!(!valid_issue_key("ABC-1/../x"));
        assert!(!valid_issue_key("ABC-1 2"));
    }

    mod worktrees {
        use std::path::{Path, PathBuf};
        use std::process::Command;

        use super::super::{
            ConflictKind, Plan, Registered, WorktreeOutcome, WorktreeStrategy, elsewhere_target,
            inspect, parse_worktrees, plan_worktree, prepare_worktree,
        };

        #[test]
        fn speaks_the_json_the_screen_expects() {
            use super::super::{WorktreeConflict, WorktreeOutcome};

            let reuse: WorktreeStrategy = serde_json::from_str(r#"{"kind":"reuse"}"#).unwrap();
            let replace: WorktreeStrategy = serde_json::from_str(r#"{"kind":"replace"}"#).unwrap();
            let there: WorktreeStrategy =
                serde_json::from_str(r#"{"kind":"elsewhere","base":"C:/w"}"#).unwrap();
            assert_eq!(reuse, WorktreeStrategy::Reuse);
            assert_eq!(replace, WorktreeStrategy::Replace);
            assert_eq!(there, WorktreeStrategy::Elsewhere { base: "C:/w".into() });

            let asked = serde_json::to_value(WorktreeOutcome::Conflict {
                conflict: WorktreeConflict {
                    kind: ConflictKind::BranchElsewhere,
                    path: "p".into(),
                    registered_at: Some("q".into()),
                    leftover: vec!["node_modules".into()],
                    replace_blocked: None,
                    elsewhere_blocked: Some("why".into()),
                },
            })
            .unwrap();
            assert_eq!(
                asked,
                serde_json::json!({
                    "status": "conflict",
                    "conflict": {
                        "kind": "branchElsewhere", "path": "p", "registeredAt": "q",
                        "leftover": ["node_modules"], "replaceBlocked": null, "elsewhereBlocked": "why"
                    }
                })
            );
        }

        fn registered(path: &str, branch: Option<&str>) -> Registered {
            Registered {
                path: PathBuf::from(path),
                branch: branch.map(str::to_string),
            }
        }

        #[test]
        fn reads_the_worktrees_git_lists() {
            let listing = "worktree C:/dev/repo\nHEAD abc\nbranch refs/heads/main\n\n\
                           worktree C:/dev/repo/.claude/worktrees/ABC-1\nHEAD def\nbranch refs/heads/ABC-1\n\n\
                           worktree C:/dev/detached\nHEAD 123\ndetached\n";
            assert_eq!(
                parse_worktrees(listing),
                vec![
                    registered("C:/dev/repo", Some("main")),
                    registered("C:/dev/repo/.claude/worktrees/ABC-1", Some("ABC-1")),
                    registered("C:/dev/detached", None),
                ]
            );
            assert_eq!(parse_worktrees(""), vec![]);
            // Windows line endings, as git may print them
            assert_eq!(
                parse_worktrees("worktree C:/a\r\nbranch refs/heads/x\r\n\r\nworktree C:/b\r\n").len(),
                2
            );
        }

        #[test]
        fn a_folder_only_counts_as_the_worktree_when_git_lists_it() {
            let usual = Path::new(r"C:\dev\repo\.claude\worktrees\ABC-1");
            let main = registered("C:/dev/repo", Some("main"));

            // Listed (whatever the spelling): used as it is
            let listed = registered("C:/dev/repo/.claude/worktrees/ABC-1", Some("ABC-1"));
            assert_eq!(plan_worktree(&[main.clone(), listed], usual, "ABC-1", true), Plan::Ready);

            // Nothing there, nothing in the way
            assert_eq!(plan_worktree(std::slice::from_ref(&main), usual, "ABC-1", false), Plan::Create);

            // A folder git doesn't know: what a removal left behind
            assert_eq!(
                plan_worktree(std::slice::from_ref(&main), usual, "ABC-1", true),
                Plan::Conflict {
                    kind: ConflictKind::Leftover,
                    branch_at: None,
                    leftover: true
                }
            );
        }

        #[test]
        fn a_branch_checked_out_elsewhere_is_in_the_way() {
            let usual = Path::new(r"C:\dev\repo\.claude\worktrees\ABC-1");
            let elsewhere = registered("C:/Users/jane/.herdr/worktrees/repo/ABC-1", Some("ABC-1"));

            for exists in [false, true] {
                assert_eq!(
                    plan_worktree(std::slice::from_ref(&elsewhere), usual, "ABC-1", exists),
                    Plan::Conflict {
                        kind: ConflictKind::BranchElsewhere,
                        branch_at: Some(elsewhere.path.clone()),
                        leftover: exists
                    }
                );
            }
            // Another ticket's branch is no concern
            assert_eq!(plan_worktree(&[elsewhere], usual, "ABC-2", false), Plan::Create);
        }

        #[test]
        fn worktrees_in_the_user_folder_go_under_the_repo_name() {
            let base = if cfg!(windows) { r"C:\Users\jane\.tracket\worktrees" } else { "/home/jane/.tracket/worktrees" };
            let target = elsewhere_target(base, "repo", "ABC-1").unwrap();
            assert_eq!(target, Path::new(base).join("repo").join("ABC-1"));
            // A relative or empty folder would put it who knows where
            assert!(elsewhere_target("worktrees", "repo", "ABC-1").is_err());
            assert!(elsewhere_target("  ", "repo", "ABC-1").is_err());
        }

        fn git(dir: &Path, args: &[&str]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(dir)
                .args(["-c", "user.name=t", "-c", "user.email=t@t.test"])
                .args(args)
                .output()
                .expect("git runs");
            assert!(
                output.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn ready(outcome: WorktreeOutcome) -> (String, bool) {
            match outcome {
                WorktreeOutcome::Ready { worktree } => (worktree.path, worktree.created),
                WorktreeOutcome::Conflict { .. } => panic!("expected a worktree, got a conflict"),
            }
        }

        fn conflict(outcome: WorktreeOutcome) -> super::super::WorktreeConflict {
            match outcome {
                WorktreeOutcome::Conflict { conflict } => conflict,
                WorktreeOutcome::Ready { .. } => panic!("expected a conflict, got a worktree"),
            }
        }

        /// A repository with an origin, in a folder of its own, and the folder to remove after.
        fn repository(name: &str) -> (PathBuf, PathBuf) {
            let home = std::env::temp_dir().join(format!("tracket-wt-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&home);
            std::fs::create_dir_all(&home).unwrap();
            git(&home, &["init", "--bare", "-b", "main", "origin.git"]);
            git(&home, &["clone", "origin.git", "repo"]);
            let repo = home.join("repo");
            std::fs::write(repo.join("README.md"), "hello").unwrap();
            git(&repo, &["add", "."]);
            git(&repo, &["commit", "-m", "first"]);
            git(&repo, &["push", "origin", "HEAD:main"]);
            (home, repo)
        }

        #[test]
        fn a_leftover_folder_is_asked_about_then_replaced() {
            let (home, repo) = repository("leftover");
            let inspected = inspect(&repo.to_string_lossy()).unwrap();
            let usual = inspected.root.join(".claude").join("worktrees").join("ABC-2");

            // A fresh ticket just gets its worktree, and again: it is the one git lists
            let (path, created) = ready(prepare_worktree(&inspected, "ABC-1", None).unwrap());
            assert!(created && Path::new(&path).join(".git").exists());
            let (_, created) = ready(prepare_worktree(&inspected, "ABC-1", None).unwrap());
            assert!(!created, "reused as it is");

            // What a removal left behind: a folder git doesn't know
            std::fs::create_dir_all(usual.join("node_modules")).unwrap();
            std::fs::write(usual.join("node_modules").join("x.js"), "x").unwrap();

            let asked = conflict(prepare_worktree(&inspected, "ABC-2", None).unwrap());
            assert_eq!(asked.kind, ConflictKind::Leftover);
            assert_eq!(asked.leftover, vec!["node_modules"]);
            assert!(asked.replace_blocked.is_none() && asked.elsewhere_blocked.is_none());
            assert!(usual.join("node_modules").exists(), "asking changes nothing");

            let (path, created) =
                ready(prepare_worktree(&inspected, "ABC-2", Some(WorktreeStrategy::Replace)).unwrap());
            assert!(created);
            assert!(Path::new(&path).join(".git").exists(), "a real worktree now");
            assert!(!usual.join("node_modules").exists(), "the leftover is gone");

            let _ = std::fs::remove_dir_all(&home);
        }

        #[test]
        fn a_leftover_folder_can_be_reused_or_worked_around() {
            let (home, repo) = repository("around");
            let inspected = inspect(&repo.to_string_lossy()).unwrap();
            let usual = inspected.root.join(".claude").join("worktrees").join("ABC-4");
            std::fs::create_dir_all(&usual).unwrap();
            std::fs::write(usual.join("keep.txt"), "mine").unwrap();

            let (path, created) =
                ready(prepare_worktree(&inspected, "ABC-4", Some(WorktreeStrategy::Reuse)).unwrap());
            assert!(!created);
            assert!(Path::new(&path).ends_with("ABC-4"));

            let base = home.join("user-folder");
            let strategy = WorktreeStrategy::Elsewhere {
                base: base.to_string_lossy().into_owned(),
            };
            let (path, created) = ready(prepare_worktree(&inspected, "ABC-4", Some(strategy)).unwrap());
            assert!(created);
            assert!(Path::new(&path).starts_with(&base) && Path::new(&path).join(".git").exists());
            assert!(usual.join("keep.txt").exists(), "the leftover isn't touched");

            // A folder that isn't a place to put worktrees is refused before anything is made
            let stray = inspected.root.join(".claude").join("worktrees").join("ABC-5");
            std::fs::create_dir_all(&stray).unwrap();
            let relative = WorktreeStrategy::Elsewhere { base: "worktrees".into() };
            assert!(prepare_worktree(&inspected, "ABC-5", Some(relative)).is_err());
            assert!(!Path::new("worktrees").exists(), "nothing was made");

            let _ = std::fs::remove_dir_all(&home);
        }

        #[test]
        fn a_branch_checked_out_elsewhere_is_reused_or_replaced_when_clean() {
            let (home, repo) = repository("elsewhere");
            let inspected = inspect(&repo.to_string_lossy()).unwrap();
            let base = home.join("user-folder");
            let user_folder = WorktreeStrategy::Elsewhere {
                base: base.to_string_lossy().into_owned(),
            };

            // The branch is checked out in the user folder, and the usual folder is a leftover
            let usual = inspected.root.join(".claude").join("worktrees").join("ABC-3");
            std::fs::create_dir_all(&usual).unwrap();
            let (there, _) = ready(prepare_worktree(&inspected, "ABC-3", Some(user_folder.clone())).unwrap());

            let asked = conflict(prepare_worktree(&inspected, "ABC-3", None).unwrap());
            assert_eq!(asked.kind, ConflictKind::BranchElsewhere);
            assert!(asked.registered_at.as_deref().is_some_and(|at| at.contains("ABC-3")));
            assert!(asked.elsewhere_blocked.is_some(), "it can't be checked out twice");
            assert!(asked.replace_blocked.is_none(), "it is clean");

            // Reusing means using the worktree git has, not the leftover
            let (path, created) =
                ready(prepare_worktree(&inspected, "ABC-3", Some(WorktreeStrategy::Reuse)).unwrap());
            // git spells the folder its own way (long names, forward slashes): the folder's name is what is compared
            assert!(!created && path.contains("user-folder") && path.ends_with("ABC-3"));

            // Asking for the same user folder again is that same worktree
            let (again, created) = ready(prepare_worktree(&inspected, "ABC-3", Some(user_folder)).unwrap());
            assert!(!created && Path::new(&again).ends_with("ABC-3"));

            // Uncommitted work is never replaced
            std::fs::write(Path::new(&there).join("work.txt"), "unsaved").unwrap();
            let asked = conflict(prepare_worktree(&inspected, "ABC-3", None).unwrap());
            assert!(asked.replace_blocked.is_some_and(|why| why.contains("uncommitted")));
            assert!(prepare_worktree(&inspected, "ABC-3", Some(WorktreeStrategy::Replace)).is_err());
            assert!(Path::new(&there).join("work.txt").exists());

            // Once clean, it moves to the usual place
            std::fs::remove_file(Path::new(&there).join("work.txt")).unwrap();
            let (path, created) =
                ready(prepare_worktree(&inspected, "ABC-3", Some(WorktreeStrategy::Replace)).unwrap());
            assert!(created && Path::new(&path).join(".git").exists());
            assert!(Path::new(&path).ends_with("ABC-3") && Path::new(&path).starts_with(&inspected.root));
            assert!(!Path::new(&there).exists(), "the old worktree is gone");

            let _ = std::fs::remove_dir_all(&home);
        }
    }
}
