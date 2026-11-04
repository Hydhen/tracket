use std::collections::HashMap;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::load_credentials;
use crate::error::{AppError, Result};

const MAX_RESULTS: u32 = 100;

const ISSUE_FIELDS: [&str; 8] = [
    "summary",
    "parent",
    "status",
    "priority",
    "duedate",
    "updated",
    "issuetype",
    "project",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Jira status id: stable across renames, and what a transition's target is matched on.
    pub id: String,
    pub name: String,
    /// Jira status category: `new` (To Do), `indeterminate` (In Progress) or `done`.
    pub category: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Named {
    pub name: String,
    pub icon_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub id: String,
    pub key: String,
    pub summary: String,
    pub status: Status,
    pub priority: Option<Named>,
    pub issue_type: Named,
    /// False for sub-tasks, which can't have children of their own.
    pub can_have_children: bool,
    pub project_key: String,
    /// Key of the parent issue (the epic of a story, the story of a sub-task…).
    pub parent_key: Option<String>,
    /// `YYYY-MM-DD`
    pub due_date: Option<String>,
    /// ISO 8601 timestamp
    pub updated: String,
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueList {
    pub issues: Vec<IssueSummary>,
    /// More results exist than the ones returned.
    pub has_more: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    issues: Vec<RawIssue>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct RawIssue {
    id: String,
    key: String,
    fields: RawFields,
}

#[derive(Deserialize)]
struct RawFields {
    summary: String,
    status: RawStatus,
    priority: Option<RawNamed>,
    duedate: Option<String>,
    updated: String,
    issuetype: RawNamed,
    project: RawProject,
    parent: Option<RawParent>,
}

#[derive(Deserialize)]
struct RawParent {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawStatus {
    id: String,
    name: String,
    status_category: RawCategory,
}

#[derive(Deserialize)]
struct RawCategory {
    key: String,
}

impl From<RawStatus> for Status {
    fn from(raw: RawStatus) -> Self {
        Self {
            id: raw.id,
            name: raw.name,
            category: raw.status_category.key,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawNamed {
    name: String,
    icon_url: Option<String>,
    /// Issue types only: epics are 1, stories and tasks 0, sub-tasks -1.
    hierarchy_level: Option<i32>,
}

#[derive(Deserialize)]
struct RawProject {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JiraErrors {
    #[serde(default)]
    error_messages: Vec<String>,
    /// Per-field problems, e.g. `{"description": "..."}` when an edit is refused.
    #[serde(default)]
    errors: HashMap<String, String>,
}

impl From<RawNamed> for Named {
    fn from(raw: RawNamed) -> Self {
        Self {
            name: raw.name,
            icon_url: raw.icon_url,
        }
    }
}

/// Turns unsuccessful Jira responses (anything but 2xx, e.g. 204 after an edit) into UI-friendly errors.
pub(crate) async fn ensure_ok(response: reqwest::Response) -> Result<reqwest::Response> {
    match response.status() {
        status if status.is_success() => Ok(response),
        StatusCode::UNAUTHORIZED => Err(AppError::new(
            "invalidCredentials",
            "Invalid email or API token",
        )),
        StatusCode::FORBIDDEN => Err(AppError::new(
            "forbidden",
            "You don't have permission to do this in Jira",
        )),
        StatusCode::NOT_FOUND => Err(AppError::new("notFound", "Not found in Jira")),
        StatusCode::BAD_REQUEST => {
            let detail = response
                .json::<JiraErrors>()
                .await
                .ok()
                .map(|e| {
                    e.error_messages
                        .into_iter()
                        .chain(e.errors.into_values())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| "Jira rejected the request".to_string());
            Err(AppError::new("invalidQuery", detail))
        }
        status => Err(AppError::new(
            "unexpected",
            format!("Unexpected response from Jira: {status}"),
        )),
    }
}

/// Runs a JQL query and returns up to `limit` (at most [`MAX_RESULTS`]) issues, in the query's order.
#[tauri::command]
pub async fn search_issues(
    http: tauri::State<'_, reqwest::Client>,
    jql: String,
    limit: Option<u32>,
) -> Result<IssueList> {
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .post(format!("{}/rest/api/3/search/jql", credentials.site))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .json(&json!({ "jql": jql, "fields": ISSUE_FIELDS, "maxResults": limit.unwrap_or(MAX_RESULTS).clamp(1, MAX_RESULTS) }))
        .send()
        .await
        .map_err(AppError::network)?;

    let response = ensure_ok(response).await?;

    let body: SearchResponse = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    let issues = body
        .issues
        .into_iter()
        .map(|raw| IssueSummary {
            url: format!("{}/browse/{}", credentials.site, raw.key),
            id: raw.id,
            key: raw.key,
            summary: raw.fields.summary,
            status: raw.fields.status.into(),
            priority: raw.fields.priority.map(Named::from),
            can_have_children: raw
                .fields
                .issuetype
                .hierarchy_level
                .is_none_or(|level| level >= 0),
            issue_type: raw.fields.issuetype.into(),
            project_key: raw.fields.project.key,
            parent_key: raw.fields.parent.map(|p| p.key),
            due_date: raw.fields.duedate,
            updated: raw.fields.updated,
        })
        .collect();

    Ok(IssueList {
        issues,
        has_more: body.next_page_token.is_some(),
    })
}
