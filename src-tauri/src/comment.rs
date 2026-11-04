//! Writing comments.
//!
//! Comments are read and written through REST API v2, where Jira exposes them as wiki markup text. API v3 would
//! need the Atlassian Document Format (ADF), which has no plain-text form to edit.

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::{Credentials, load_credentials};
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;
use crate::metadata::is_account_id;

/// How wiki markup writes a mention: `[~accountid:5b10ac8d…]`.
const MENTION_OPEN: &str = "[~accountid:";

fn credentials() -> Result<Credentials> {
    load_credentials()?.ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))
}

fn validate_comment_id(id: &str) -> Result<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::new("invalidQuery", "Invalid comment id"));
    }
    Ok(())
}

fn ensure_text(text: &str) -> Result<()> {
    if text.trim().is_empty() {
        return Err(AppError::new("invalidQuery", "Write something to comment"));
    }
    Ok(())
}

/// Adds a comment (wiki markup) to the issue.
#[tauri::command]
pub async fn add_comment(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    text: String,
) -> Result<()> {
    validate_key(&key)?;
    ensure_text(&text)?;
    let credentials = credentials()?;

    let response = http
        .post(format!(
            "{}/rest/api/2/issue/{key}/comment",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .json(&json!({ "body": text }))
        .send()
        .await
        .map_err(AppError::network)?;
    ensure_ok(response).await?;

    Ok(())
}

/// Replaces the text of a comment (wiki markup).
#[tauri::command]
pub async fn update_comment(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    id: String,
    text: String,
) -> Result<()> {
    validate_key(&key)?;
    validate_comment_id(&id)?;
    ensure_text(&text)?;
    let credentials = credentials()?;

    let response = http
        .put(format!(
            "{}/rest/api/2/issue/{key}/comment/{id}",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .json(&json!({ "body": text }))
        .send()
        .await
        .map_err(AppError::network)?;
    ensure_ok(response).await?;

    Ok(())
}

/// A person a comment mentions, as the editor lists them.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub account_id: String,
    pub display_name: String,
}

/// A comment ready to edit: mentions are written `@Name`, and `mentions` says who each one is.
#[derive(Serialize)]
pub struct CommentSource {
    pub text: String,
    pub mentions: Vec<Mention>,
}

#[derive(Deserialize)]
struct RawComment {
    body: Option<String>,
}

#[derive(Deserialize)]
struct RawUsers {
    #[serde(default)]
    values: Vec<RawPerson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPerson {
    account_id: String,
    display_name: String,
}

/// The account ids mentioned in wiki markup, each once, in order of appearance.
fn mentioned_ids(text: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(MENTION_OPEN) {
        let after = &rest[start + MENTION_OPEN.len()..];
        let Some(end) = after.find(']') else { break };
        let id = &after[..end];
        if is_account_id(id) && !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
        rest = &after[end + 1..];
    }
    ids
}

/// Writes each known mention as `@Name`. Someone whose name is shared with another mentioned person stays as
/// markup, since `@Name` alone couldn't say which of them it is.
fn name_mentions(text: &str, people: Vec<Mention>) -> (String, Vec<Mention>) {
    let unique: Vec<Mention> = people
        .iter()
        .filter(|p| people.iter().filter(|o| o.display_name == p.display_name).count() == 1)
        .cloned()
        .collect();
    let named = unique.iter().fold(text.to_string(), |text, person| {
        text.replace(
            &format!("{MENTION_OPEN}{}]", person.account_id),
            &format!("@{}", person.display_name),
        )
    });
    (named, unique)
}

/// Looks the people up. Failing is fine: the comment is then edited with its markup as it is.
async fn lookup(
    http: &reqwest::Client,
    credentials: &Credentials,
    ids: &[String],
) -> Option<Vec<Mention>> {
    let url = Url::parse_with_params(
        &format!("{}/rest/api/3/user/bulk", credentials.site),
        ids.iter().map(|id| ("accountId", id.as_str())),
    )
    .ok()?;
    let response = http
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .ok()?;
    let users: RawUsers = ensure_ok(response).await.ok()?.json().await.ok()?;
    Some(
        users
            .values
            .into_iter()
            .map(|p| Mention {
                account_id: p.account_id,
                display_name: p.display_name,
            })
            .collect(),
    )
}

/// A comment as editable wiki markup, with its mentions written as `@Name`.
#[tauri::command]
pub async fn get_comment_source(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    id: String,
) -> Result<CommentSource> {
    validate_key(&key)?;
    validate_comment_id(&id)?;
    let credentials = credentials()?;

    let response = http
        .get(format!(
            "{}/rest/api/2/issue/{key}/comment/{id}",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let comment: RawComment = ensure_ok(response)
        .await?
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;
    let text = comment.body.unwrap_or_default();

    let ids = mentioned_ids(&text);
    let people = if ids.is_empty() {
        Vec::new()
    } else {
        lookup(&http, &credentials, &ids).await.unwrap_or_default()
    };
    let (text, mentions) = name_mentions(&text, people);
    Ok(CommentSource { text, mentions })
}

#[cfg(test)]
mod tests {
    use super::{Mention, mentioned_ids, name_mentions};

    fn person(id: &str, name: &str) -> Mention {
        Mention {
            account_id: id.into(),
            display_name: name.into(),
        }
    }

    #[test]
    fn finds_each_mentioned_account_once() {
        let text = "[~accountid:5b10] and [~accountid:557058:f58] and [~accountid:5b10] again [~accountid:bad id] [~accountid:";
        assert_eq!(mentioned_ids(text), ["5b10", "557058:f58"]);
        assert!(mentioned_ids("no one here").is_empty());
    }

    #[test]
    fn writes_mentions_as_names() {
        let (text, mentions) = name_mentions(
            "hi [~accountid:1], see [~accountid:2] and [~accountid:1]",
            vec![person("1", "Ann Lee"), person("2", "Bob")],
        );
        assert_eq!(text, "hi @Ann Lee, see @Bob and @Ann Lee");
        assert_eq!(mentions.len(), 2);
    }

    #[test]
    fn keeps_the_markup_of_people_sharing_a_name() {
        let (text, mentions) = name_mentions(
            "[~accountid:1] [~accountid:2] [~accountid:3]",
            vec![person("1", "Sam"), person("2", "Sam"), person("3", "Kim")],
        );
        assert_eq!(text, "[~accountid:1] [~accountid:2] @Kim");
        assert_eq!(mentions, [person("3", "Kim")]);
    }
}
