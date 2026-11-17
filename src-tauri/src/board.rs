//! Jira Software boards: which ones exist, their columns and sprints, and the tickets on them.
//!
//! This is the only part of the app that uses Jira's agile API (`/rest/agile/1.0`), which only exists on
//! sites with Jira Software. Projects are listed too, for the sites and projects that have no board: their
//! tickets are then searched with JQL like everywhere else.

use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};

use crate::auth::{Credentials, load_credentials};
use crate::error::{AppError, Result};
use crate::jira::{ISSUE_FIELDS, IssueList, RawIssue, ensure_ok, summarize};

const PAGE: u32 = 100;
/// Boards and projects are listed in pages of 50, up to this many pages (a few hundred is plenty to pick from).
const LIST_PAGES: u32 = 6;
/// A sprint or a board is read in pages of [`PAGE`], up to this many.
const ISSUE_PAGES: u32 = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: u64,
    pub name: String,
    /// `scrum`, `kanban` or `simple` (team-managed projects)
    pub kind: String,
    pub project_key: Option<String>,
}

#[derive(Serialize)]
pub struct Project {
    pub key: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    pub name: String,
    /// Jira status ids shown in this column
    pub status_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct Sprint {
    pub id: u64,
    pub name: String,
    /// `active` or `future`
    pub state: String,
}

/// What to read from a board.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BoardScope {
    /// Everything the board's filter lets through (what a kanban board shows)
    Board,
    /// The tickets that are in no sprint
    Backlog,
    Sprint { id: u64 },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    #[serde(default = "Vec::new")]
    values: Vec<T>,
    is_last: Option<bool>,
}

#[derive(Deserialize)]
struct RawBoard {
    id: u64,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    location: Option<RawLocation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLocation {
    project_key: Option<String>,
}

#[derive(Deserialize)]
struct RawProjectEntry {
    key: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConfig {
    column_config: RawColumnConfig,
}

#[derive(Deserialize)]
struct RawColumnConfig {
    columns: Vec<RawColumn>,
}

#[derive(Deserialize)]
struct RawColumn {
    name: String,
    #[serde(default)]
    statuses: Vec<RawColumnStatus>,
}

#[derive(Deserialize)]
struct RawColumnStatus {
    id: String,
}

#[derive(Deserialize)]
struct RawSprint {
    id: u64,
    name: String,
    state: String,
}

#[derive(Deserialize)]
struct RawIssuePage {
    #[serde(default)]
    issues: Vec<RawIssue>,
    #[serde(default, rename = "startAt")]
    start_at: u32,
    total: Option<u32>,
}

fn credentials() -> Result<Credentials> {
    load_credentials()?.ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))
}

fn url(credentials: &Credentials, path: &str, params: &[(&str, &str)]) -> Result<Url> {
    Url::parse_with_params(&format!("{}{path}", credentials.site), params)
        .map_err(|_| AppError::new("invalidQuery", "Invalid request"))
}

async fn get<T: for<'de> Deserialize<'de>>(
    http: &reqwest::Client,
    credentials: &Credentials,
    url: Url,
) -> Result<T> {
    let response = http
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;
    response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))
}

/// The boards the user can see, by name. Sites without Jira Software have none (the agile API answers 404).
#[tauri::command]
pub async fn list_boards(http: tauri::State<'_, reqwest::Client>) -> Result<Vec<Board>> {
    let credentials = credentials()?;
    let mut boards = Vec::new();

    for page in 0..LIST_PAGES {
        let start = (page * 50).to_string();
        let url = url(
            &credentials,
            "/rest/agile/1.0/board",
            &[("orderBy", "name"), ("maxResults", "50"), ("startAt", &start)],
        )?;
        let page: Page<RawBoard> = match get(&http, &credentials, url).await {
            Ok(page) => page,
            // No Jira Software here, or no right to see boards: the projects are still there
            Err(e) if boards.is_empty() && matches!(e.kind, "notFound" | "forbidden") => return Ok(boards),
            Err(e) => return Err(e),
        };
        let last = page.is_last.unwrap_or(page.values.len() < 50);
        boards.extend(page.values.into_iter().map(|b| Board {
            id: b.id,
            name: b.name,
            kind: b.kind,
            project_key: b.location.and_then(|l| l.project_key),
        }));
        if last {
            break;
        }
    }
    Ok(boards)
}

/// The projects the user can browse, by key.
#[tauri::command]
pub async fn list_projects(http: tauri::State<'_, reqwest::Client>) -> Result<Vec<Project>> {
    let credentials = credentials()?;
    let mut projects = Vec::new();

    for page in 0..LIST_PAGES {
        let start = (page * 50).to_string();
        let url = url(
            &credentials,
            "/rest/api/3/project/search",
            &[("orderBy", "key"), ("maxResults", "50"), ("startAt", &start)],
        )?;
        let page: Page<RawProjectEntry> = get(&http, &credentials, url).await?;
        let last = page.is_last.unwrap_or(page.values.len() < 50);
        projects.extend(page.values.into_iter().map(|p| Project {
            key: p.key,
            name: p.name,
        }));
        if last {
            break;
        }
    }
    Ok(projects)
}

/// The columns of a board, each with the statuses it holds.
#[tauri::command]
pub async fn get_board_columns(
    http: tauri::State<'_, reqwest::Client>,
    board_id: u64,
) -> Result<Vec<BoardColumn>> {
    let credentials = credentials()?;
    let url = url(
        &credentials,
        &format!("/rest/agile/1.0/board/{board_id}/configuration"),
        &[],
    )?;
    let config: RawConfig = get(&http, &credentials, url).await?;

    Ok(config
        .column_config
        .columns
        .into_iter()
        .map(|c| BoardColumn {
            name: c.name,
            status_ids: c.statuses.into_iter().map(|s| s.id).collect(),
        })
        .collect())
}

/// The sprints a board is working on or has planned. Kanban boards have none: Jira refuses the question.
#[tauri::command]
pub async fn get_board_sprints(
    http: tauri::State<'_, reqwest::Client>,
    board_id: u64,
) -> Result<Vec<Sprint>> {
    let credentials = credentials()?;
    let url = url(
        &credentials,
        &format!("/rest/agile/1.0/board/{board_id}/sprint"),
        &[("state", "active,future"), ("maxResults", "50")],
    )?;

    let response = http
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    if response.status() == StatusCode::BAD_REQUEST {
        return Ok(Vec::new());
    }
    let response = ensure_ok(response).await?;
    let page: Page<RawSprint> = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    Ok(page
        .values
        .into_iter()
        .map(|s| Sprint {
            id: s.id,
            name: s.name,
            state: s.state,
        })
        .collect())
}

/// The tickets of a board, of its backlog or of one of its sprints, narrowed by `jql` when given.
/// `has_more` is set when the board holds more than what is read here.
#[tauri::command]
pub async fn get_board_issues(
    http: tauri::State<'_, reqwest::Client>,
    board_id: u64,
    scope: BoardScope,
    jql: Option<String>,
) -> Result<IssueList> {
    let credentials = credentials()?;
    let path = match scope {
        BoardScope::Board => format!("/rest/agile/1.0/board/{board_id}/issue"),
        BoardScope::Backlog => format!("/rest/agile/1.0/board/{board_id}/backlog"),
        BoardScope::Sprint { id } => format!("/rest/agile/1.0/board/{board_id}/sprint/{id}/issue"),
    };
    let fields = ISSUE_FIELDS.join(",");
    let size = PAGE.to_string();

    let mut issues = Vec::new();
    let mut has_more = false;
    for page in 0..ISSUE_PAGES {
        let start = (page * PAGE).to_string();
        let mut params = vec![
            ("fields", fields.as_str()),
            ("maxResults", size.as_str()),
            ("startAt", start.as_str()),
        ];
        if let Some(jql) = jql.as_deref().filter(|j| !j.trim().is_empty()) {
            params.push(("jql", jql));
        }
        let body: RawIssuePage = get(&http, &credentials, url(&credentials, &path, &params)?).await?;

        let read = body.issues.len() as u32;
        let total = body.total.unwrap_or(0);
        issues.extend(body.issues.into_iter().map(|raw| summarize(raw, &credentials.site)));

        let more = if total > 0 { body.start_at + read < total } else { read == PAGE };
        if !more {
            break;
        }
        has_more = page + 1 == ISSUE_PAGES;
    }

    Ok(IssueList { issues, has_more })
}
