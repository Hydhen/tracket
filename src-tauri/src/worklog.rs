//! Logging work on issues.
//!
//! Uses REST API v2 so the comment is plain text; API v3 would need the Atlassian Document Format.

use serde_json::{Map, Value, json};

use crate::auth::load_credentials;
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;

/// Jira rejects worklogs shorter than a minute.
const MIN_SECONDS: u64 = 60;

/// Jira's timestamp format, e.g. `2026-10-29T14:05:00.000+0100`.
fn is_jira_timestamp(s: &str) -> bool {
    const SHAPE: &[u8; 28] = b"dddd-dd-ddTdd:dd:dd.dddsdddd";
    s.len() == SHAPE.len()
        && s.bytes().zip(SHAPE).all(|(b, shape)| match shape {
            b'd' => b.is_ascii_digit(),
            b's' => b == b'+' || b == b'-',
            literal => b == *literal,
        })
}

/// Logs `seconds` of work on the issue, which started at `started` (Jira timestamp format).
#[tauri::command]
pub async fn add_worklog(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    seconds: u64,
    started: String,
    comment: Option<String>,
) -> Result<()> {
    validate_key(&key)?;
    if seconds < MIN_SECONDS {
        return Err(AppError::new(
            "invalidQuery",
            "Jira only logs work of at least a minute",
        ));
    }
    if !is_jira_timestamp(&started) {
        return Err(AppError::new("invalidQuery", "Invalid start time"));
    }
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let mut body = Map::new();
    body.insert("timeSpentSeconds".into(), json!(seconds));
    body.insert("started".into(), Value::String(started));
    if let Some(comment) = comment.filter(|c| !c.trim().is_empty()) {
        body.insert("comment".into(), Value::String(comment));
    }

    let response = http
        .post(format!(
            "{}/rest/api/2/issue/{key}/worklog",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .json(&body)
        .send()
        .await
        .map_err(AppError::network)?;
    ensure_ok(response).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_jira_timestamp;

    #[test]
    fn accepts_only_jira_timestamps() {
        assert!(is_jira_timestamp("2026-10-29T14:05:00.000+0100"));
        assert!(!is_jira_timestamp("2026-10-29T14:05:00Z"));
        assert!(!is_jira_timestamp("2026-10-29T14:05:00.000+01:0"));
        assert!(!is_jira_timestamp("2026-10-29T14:05:00.000+01;0"));
    }
}
