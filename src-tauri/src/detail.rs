use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::auth::load_credentials;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;

const DETAIL_FIELDS: &str =
    "description,comment,attachment,assignee,reporter,labels,created,parent";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct ParentRef {
    pub key: String,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: Option<Person>,
    pub created: String,
    pub updated: String,
    /// HTML rendered by Jira. Must be sanitized by the UI before display.
    pub body_html: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub key: String,
    /// HTML rendered by Jira. Must be sanitized by the UI before display.
    pub description_html: Option<String>,
    pub assignee: Option<Person>,
    pub reporter: Option<Person>,
    pub labels: Vec<String>,
    pub created: String,
    pub parent: Option<ParentRef>,
    pub attachments: Vec<Attachment>,
    pub comments: Vec<Comment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssue {
    key: String,
    fields: RawFields,
    rendered_fields: Option<RawRendered>,
}

#[derive(Deserialize)]
struct RawFields {
    assignee: Option<RawUser>,
    reporter: Option<RawUser>,
    #[serde(default)]
    labels: Vec<String>,
    created: String,
    parent: Option<RawParent>,
    #[serde(default)]
    attachment: Vec<RawAttachment>,
    comment: Option<RawCommentPage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawUser {
    display_name: String,
    avatar_urls: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
struct RawParent {
    key: String,
    fields: RawParentFields,
}

#[derive(Deserialize)]
struct RawParentFields {
    summary: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAttachment {
    id: String,
    filename: String,
    mime_type: Option<String>,
    size: Option<u64>,
}

#[derive(Deserialize)]
struct RawCommentPage {
    #[serde(default)]
    comments: Vec<RawComment>,
}

#[derive(Deserialize)]
struct RawComment {
    id: String,
    author: Option<RawUser>,
    created: String,
    updated: String,
}

#[derive(Deserialize)]
struct RawRendered {
    description: Option<String>,
    comment: Option<RawRenderedComments>,
}

#[derive(Deserialize)]
struct RawRenderedComments {
    #[serde(default)]
    comments: Vec<RawRenderedComment>,
}

#[derive(Deserialize)]
struct RawRenderedComment {
    id: String,
    body: Option<String>,
}

impl From<RawUser> for Person {
    fn from(raw: RawUser) -> Self {
        Self {
            display_name: raw.display_name,
            avatar_url: raw.avatar_urls.and_then(|mut urls| urls.remove("48x48")),
        }
    }
}

/// The key ends up in a URL path, so only the Jira key shape is accepted.
pub(crate) fn validate_key(key: &str) -> Result<()> {
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::new("invalidQuery", "Invalid issue key"));
    }
    Ok(())
}

/// Fetches the content of one issue: description, comments, attachments and people.
#[tauri::command]
pub async fn get_issue(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
) -> Result<IssueDetail> {
    validate_key(&key)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .get(format!(
            "{}/rest/api/3/issue/{key}?fields={DETAIL_FIELDS}&expand=renderedFields",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;

    let raw: RawIssue = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    let (description_html, mut rendered_comments) = match raw.rendered_fields {
        Some(rendered) => (
            rendered.description.filter(|d| !d.trim().is_empty()),
            rendered
                .comment
                .map(|c| c.comments)
                .unwrap_or_default()
                .into_iter()
                .map(|c| (c.id, c.body.unwrap_or_default()))
                .collect::<HashMap<_, _>>(),
        ),
        None => (None, HashMap::new()),
    };

    let comments = raw
        .fields
        .comment
        .map(|page| page.comments)
        .unwrap_or_default()
        .into_iter()
        .map(|c| Comment {
            body_html: rendered_comments.remove(&c.id).unwrap_or_default(),
            id: c.id,
            author: c.author.map(Person::from),
            created: c.created,
            updated: c.updated,
        })
        .collect();

    Ok(IssueDetail {
        key: raw.key,
        description_html,
        assignee: raw.fields.assignee.map(Person::from),
        reporter: raw.fields.reporter.map(Person::from),
        labels: raw.fields.labels,
        created: raw.fields.created,
        parent: raw.fields.parent.map(|p| ParentRef {
            key: p.key,
            summary: p.fields.summary,
        }),
        attachments: raw
            .fields
            .attachment
            .into_iter()
            .map(|a| Attachment {
                id: a.id,
                filename: a.filename,
                mime_type: a.mime_type.unwrap_or_default(),
                size: a.size.unwrap_or(0),
            })
            .collect(),
        comments,
    })
}
