//! Sprocket, the companion app that runs Claude agent workflows on tickets: signing in to it, and the
//! few calls the ticket view makes (its workflows, a ticket's runs, starting a run, answering an approval).
//!
//! Like Jira, it is only ever called from here: the interface makes no network calls. The address and
//! token are kept in the keychain next to the Jira credentials, and the token never reaches the interface.
//! `http://` is accepted for this computer only (Sprocket listens on 127.0.0.1); anything else needs https.

use keyring::Entry;
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, Result};

const KEYRING_SERVICE: &str = "com.tracket.app";
const KEYRING_USER: &str = "sprocket";
/// Where Sprocket keeps its own token, read once at sign-in when Sprocket runs on this computer
const SPROCKET_SERVICE: &str = "sprocket";
const SPROCKET_USER: &str = "api-token";

#[derive(Serialize, Deserialize, Clone)]
struct Connection {
    address: String,
    token: String,
}

/// What the interface may know about the connection.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketSession {
    address: String,
    /// False when Sprocket doesn't answer (closed, or the token changed); the address is kept
    reachable: bool,
    version: Option<String>,
    /// Whether its agents can run (its agent host is ready)
    agents_ready: bool,
    message: Option<String>,
}

fn error(message: impl Into<String>) -> AppError {
    AppError::new("sprocket", message)
}

fn entry() -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::new("keychain", e.to_string()))
}

fn load() -> Result<Option<Connection>> {
    match entry()?.get_password() {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| AppError::new("keychain", format!("The Sprocket connection is unreadable: {e}"))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::new("keychain", e.to_string())),
    }
}

fn connection() -> Result<Connection> {
    load()?.ok_or_else(|| error("Not signed in to Sprocket: see Settings › Sprocket"))
}

/// Removes the connection; part of signing out of Tracket too.
pub fn forget() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::new("keychain", e.to_string())),
    }
}

fn is_this_computer(url: &Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1"))
}

/// `127.0.0.1:47821` or a full URL, as `http://127.0.0.1:47821` (no trailing slash).
fn normalize_address(input: &str) -> Result<Url> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(error("Enter Sprocket's address, as shown in Sprocket › Integrations"));
    }
    let with_scheme = if trimmed.contains("://") { trimmed.to_string() } else { format!("http://{trimmed}") };
    let url = Url::parse(&with_scheme).map_err(|_| error("This doesn't look like an address"))?;
    match url.scheme() {
        "https" => {}
        "http" if is_this_computer(&url) => {}
        "http" => return Err(error("Use https, unless Sprocket runs on this computer")),
        _ => return Err(error("This doesn't look like an address")),
    }
    if url.host_str().is_none() {
        return Err(error("This doesn't look like an address"));
    }
    Ok(url)
}

/// Sprocket's own token, when it runs on this computer under the same Windows user.
fn local_token() -> Option<String> {
    Entry::new(SPROCKET_SERVICE, SPROCKET_USER).ok()?.get_password().ok()
}

async fn send(http: &reqwest::Client, conn: &Connection, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
    let mut request = http.request(method, format!("{}{path}", conn.address)).bearer_auth(&conn.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            error("Sprocket doesn't answer. Is it running?")
        } else {
            error(e.to_string())
        }
    })?;
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(value);
    }
    let said = value["error"].as_str().map(str::to_string);
    Err(match status {
        StatusCode::UNAUTHORIZED => error("Sprocket refused the token: sign in again in Settings › Sprocket"),
        StatusCode::NOT_FOUND | StatusCode::CONFLICT | StatusCode::BAD_REQUEST => {
            error(said.unwrap_or_else(|| format!("Sprocket answered {status}")))
        }
        _ => error(format!("Sprocket answered {status}{}", said.map(|s| format!(": {s}")).unwrap_or_default())),
    })
}

async fn session_of(http: &reqwest::Client, conn: &Connection) -> SprocketSession {
    match send(http, conn, Method::GET, "/v1/health", None).await {
        Ok(health) => SprocketSession {
            address: conn.address.clone(),
            reachable: true,
            version: health["version"].as_str().map(str::to_string),
            agents_ready: health["host"]["state"] == "ready",
            message: None,
        },
        Err(e) => SprocketSession {
            address: conn.address.clone(),
            reachable: false,
            version: None,
            agents_ready: false,
            message: Some(e.message),
        },
    }
}

/// The connection to use for an address, checked with Sprocket. Without a token, Sprocket's own is used
/// when it runs on this computer.
async fn check(http: &reqwest::Client, address: &str, token: Option<String>) -> Result<(Connection, SprocketSession)> {
    let url = normalize_address(address)?;
    let token = match token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(token) => token,
        None if is_this_computer(&url) => local_token().ok_or_else(|| {
            error("Sprocket's token wasn't found on this computer. Copy it from Sprocket › Integrations and paste it here.")
        })?,
        None => return Err(error("Paste the token from Sprocket › Integrations")),
    };
    let conn = Connection { address: url.as_str().trim_end_matches('/').to_string(), token };
    let session = session_of(http, &conn).await;
    if !session.reachable {
        return Err(error(session.message.unwrap_or_else(|| "Sprocket doesn't answer".into())));
    }
    Ok((conn, session))
}

/// Checks the address and token with Sprocket, then keeps them in the keychain.
#[tauri::command]
pub async fn sprocket_sign_in(
    http: tauri::State<'_, reqwest::Client>,
    address: String,
    token: Option<String>,
) -> Result<SprocketSession> {
    let (conn, session) = check(&http, &address, token).await?;
    let json = serde_json::to_string(&conn).map_err(|e| AppError::new("keychain", e.to_string()))?;
    entry()?.set_password(&json).map_err(|e| AppError::new("keychain", e.to_string()))?;
    Ok(session)
}

/// The connection, checked with Sprocket; None when not signed in.
#[tauri::command]
pub async fn sprocket_session(http: tauri::State<'_, reqwest::Client>) -> Result<Option<SprocketSession>> {
    match load()? {
        Some(conn) => Ok(Some(session_of(&http, &conn).await)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn sprocket_sign_out() -> Result<()> {
    forget()
}

/// The workflows Sprocket offers in Tracket: `[{ id, name, description }]`.
#[tauri::command]
pub async fn sprocket_workflows(http: tauri::State<'_, reqwest::Client>) -> Result<Value> {
    let workflows = send(&http, &connection()?, Method::GET, "/v1/workflows?offered=true", None).await?;
    Ok(workflows["workflows"].clone())
}

/// The ticket's runs, newest first, as Sprocket describes them.
#[tauri::command]
pub async fn sprocket_runs(http: tauri::State<'_, reqwest::Client>, key: String) -> Result<Value> {
    if !crate::workspace::valid_issue_key(&key) {
        return Err(AppError::new("invalidQuery", "Invalid issue key"));
    }
    send(&http, &connection()?, Method::GET, &format!("/v1/runs?ticket={key}"), None).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRun {
    workflow: String,
    key: String,
    title: String,
    url: String,
    /// The ticket's worktree
    folder: String,
    started_by: String,
}

/// Starts a workflow on the ticket, in its worktree. Sends the ticket's key, title and link, and the folder.
#[tauri::command]
pub async fn sprocket_start_run(http: tauri::State<'_, reqwest::Client>, run: StartRun) -> Result<Value> {
    if !crate::workspace::valid_issue_key(&run.key) {
        return Err(AppError::new("invalidQuery", "Invalid issue key"));
    }
    let body = json!({
        "workflow": run.workflow,
        "ticket": { "key": run.key, "title": run.title, "url": run.url },
        "folder": run.folder,
        "startedBy": run.started_by,
    });
    send(&http, &connection()?, Method::POST, "/v1/runs", Some(body)).await
}

/// Approves or rejects a step or a tool call that waits for someone.
#[tauri::command]
pub async fn sprocket_decide(
    http: tauri::State<'_, reqwest::Client>,
    id: String,
    approve: bool,
    reason: Option<String>,
    by: String,
) -> Result<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::new("invalidQuery", "Invalid approval"));
    }
    let body = json!({ "decision": if approve { "approve" } else { "reject" }, "reason": reason, "by": by });
    send(&http, &connection()?, Method::POST, &format!("/v1/approvals/{id}"), Some(body)).await.map(drop)
}

#[cfg(test)]
mod tests {
    use super::{check, normalize_address, send};
    use reqwest::Method;

    /// Against the Sprocket running on this computer: `cargo test -- --ignored sprocket`. Nothing is saved.
    #[test]
    #[ignore]
    fn signs_in_to_the_local_sprocket_and_reads_its_workflows_and_runs() {
        tauri::async_runtime::block_on(async {
            let http = crate::auth::build_http_client();
            let (conn, session) = check(&http, "127.0.0.1:47821", None).await.map_err(|e| e.message).unwrap();
            assert!(session.reachable);
            println!("version {:?}, agents ready {}", session.version, session.agents_ready);
            let workflows = send(&http, &conn, Method::GET, "/v1/workflows?offered=true", None).await.map_err(|e| e.message).unwrap();
            println!("workflows {}", workflows["workflows"]);
            let runs = send(&http, &conn, Method::GET, "/v1/runs?ticket=SMOKE-2", None).await.map_err(|e| e.message).unwrap();
            println!("SMOKE-2 runs {}, first is {}", runs.as_array().map_or(0, Vec::len), runs[0]["state"]);
            let wrong = super::Connection { address: conn.address.clone(), token: "wrong".into() };
            let refused = send(&http, &wrong, Method::GET, "/v1/health", None).await.err().unwrap();
            println!("wrong token: {}", refused.message);
        });
    }

    #[test]
    fn accepts_this_computer_over_http_and_anything_else_over_https() {
        let ok = |s: &str| normalize_address(s).unwrap().as_str().trim_end_matches('/').to_string();
        assert_eq!(ok("127.0.0.1:47821"), "http://127.0.0.1:47821");
        assert_eq!(ok(" http://localhost:47821/ "), "http://localhost:47821");
        assert_eq!(ok("https://sprocket.example.internal"), "https://sprocket.example.internal");
        assert!(normalize_address("http://sprocket.example.internal").is_err());
        assert!(normalize_address("ftp://127.0.0.1").is_err());
        assert!(normalize_address("").is_err());
    }
}
