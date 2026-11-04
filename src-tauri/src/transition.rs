//! Moving issues through their workflow.
//!
//! Uses REST API v2 so the text of fields and comments that a transition asks for is plain text;
//! API v3 would need the Atlassian Document Format.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::auth::load_credentials;
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::{RawStatus, Status, ensure_ok};
use crate::metadata::{EditField, FieldChange, RawField, edit_body, screen_fields};

/// A move the issue can make right now; the same status can be reached by different transitions
/// depending on where each issue is, so callers match on `to.id`, not on the transition.
#[derive(Serialize)]
pub struct Transition {
    pub id: String,
    pub name: String,
    pub to: Status,
    /// What Jira insists on before making this move (a resolution, a comment…), as editors to show
    pub required: Vec<EditField>,
    /// The other fields of the move's screen: Jira's workflow can still insist on some of them
    /// without saying so, which only its refusal reveals
    pub optional: Vec<EditField>,
    /// Names of required fields that can't be filled in here: the move has to be made in Jira
    pub unsupported: Vec<String>,
}

#[derive(Deserialize)]
struct TransitionsResponse {
    transitions: Vec<RawTransition>,
}

#[derive(Deserialize)]
struct RawTransition {
    id: String,
    name: String,
    to: RawStatus,
    /// The fields of the transition's screen
    #[serde(default)]
    fields: HashMap<String, RawField>,
}

/// The transitions available to the current user on this issue, from its current status.
#[tauri::command]
pub async fn get_transitions(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
) -> Result<Vec<Transition>> {
    validate_key(&key)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .get(format!(
            "{}/rest/api/2/issue/{key}/transitions?expand=transitions.fields",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;

    let body: TransitionsResponse = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    Ok(body
        .transitions
        .into_iter()
        .map(|t| {
            let screen = screen_fields(t.fields);
            Transition {
                id: t.id,
                name: t.name,
                to: t.to.into(),
                required: screen.required,
                optional: screen.optional,
                unsupported: screen.unsupported,
            }
        })
        .collect())
}

/// The request that applies a transition, with the values of the fields it asks for.
fn transition_body(transition_id: &str, changes: &[FieldChange]) -> Result<Value> {
    // Goes into the request body, but stay strict: Jira transition ids are numbers
    if transition_id.is_empty() || !transition_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::new("invalidQuery", "Invalid transition id"));
    }
    let mut body = json!({ "transition": { "id": transition_id } });
    if !changes.is_empty()
        && let (Value::Object(body), Value::Object(extra)) = (&mut body, edit_body(changes)?)
    {
        body.extend(extra);
    }
    Ok(body)
}

/// Applies one transition, with the values of the fields it asks for. Jira refuses it with a
/// readable message when the move needs more than that (a resolution, a required field…), which
/// is passed on as the error.
#[tauri::command]
pub async fn transition_issue(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    transition_id: String,
    changes: Vec<FieldChange>,
) -> Result<()> {
    validate_key(&key)?;
    let body = transition_body(&transition_id, &changes)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .post(format!(
            "{}/rest/api/2/issue/{key}/transitions",
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
    use serde_json::json;

    use super::transition_body;
    use crate::metadata::FieldChange;

    fn changes(value: serde_json::Value) -> Vec<FieldChange> {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_plain_transition_carries_only_its_id() {
        assert_eq!(
            transition_body("31", &[]).unwrap(),
            json!({ "transition": { "id": "31" } })
        );
    }

    #[test]
    fn a_transition_carries_the_fields_it_asked_for() {
        let body = transition_body(
            "31",
            &changes(json!([
                { "key": "resolution", "op": "setChoice", "id": "10000" },
                { "key": "comment", "op": "addComment", "text": " Shipped " },
            ])),
        )
        .unwrap();
        assert_eq!(
            body,
            json!({
                "transition": { "id": "31" },
                "fields": { "resolution": { "id": "10000" } },
                "update": { "comment": [{ "add": { "body": "Shipped" } }] },
            })
        );
    }

    #[test]
    fn refuses_a_transition_id_that_is_not_a_number() {
        assert!(transition_body("31\"}", &[]).is_err());
        assert!(transition_body("", &[]).is_err());
    }
}
