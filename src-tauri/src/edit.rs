//! Editing issue fields.
//!
//! Descriptions and comments are read and written through REST API v2, where Jira exposes them as wiki
//! markup text. API v3 would need the Atlassian Document Format (ADF), which has no plain-text form to edit.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::load_credentials;
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;

#[derive(Deserialize)]
struct SourceResponse {
    fields: SourceFields,
}

#[derive(Deserialize)]
struct SourceFields {
    description: Option<String>,
}

/// The description as editable wiki markup (empty when the issue has none).
#[tauri::command]
pub async fn get_description_source(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
) -> Result<String> {
    validate_key(&key)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .get(format!(
            "{}/rest/api/2/issue/{key}?fields=description",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;

    let body: SourceResponse = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    Ok(body.fields.description.unwrap_or_default())
}

/// Replaces the description with `text` (wiki markup). Blank text clears it.
#[tauri::command]
pub async fn update_description(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    text: String,
) -> Result<()> {
    validate_key(&key)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let description = if text.trim().is_empty() {
        Value::Null
    } else {
        Value::String(text)
    };

    let response = http
        .put(format!("{}/rest/api/2/issue/{key}", credentials.site))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .json(&json!({ "fields": { "description": description } }))
        .send()
        .await
        .map_err(AppError::network)?;
    ensure_ok(response).await?;

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
    if text.trim().is_empty() {
        return Err(AppError::new("invalidQuery", "Write something to comment"));
    }
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

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
