//! Showing any field of an issue (custom fields included) in the ticket details.
//!
//! Like `metadata`, nothing about specific fields is hardcoded: `get_ticket_fields` lists the fields
//! the Jira site has for an issue, and `get_field_values` reads some of them and flattens whatever
//! they hold (text, options, people, versions, sprints, rich text…) into plain strings to display.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth::load_credentials;
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;
use crate::metadata::is_field_key;

/// Fields the details already show in their own way, or that are shown elsewhere on the page.
const SHOWN_ELSEWHERE: &[&str] = &[
    "summary",
    "description",
    "issuetype",
    "project",
    "status",
    "priority",
    "duedate",
    "assignee",
    "reporter",
    "labels",
    "attachment",
    "comment",
    "issuelinks",
    "subtasks",
    "parent",
];

/// The longest text kept of one value: rich text fields can hold whole documents.
const MAX_CHARS: usize = 2000;

#[derive(Serialize, Debug, PartialEq)]
pub struct FieldRef {
    pub key: String,
    /// As named in the user's Jira (so in the user's language)
    pub name: String,
}

#[derive(Deserialize)]
struct EditMetaResponse {
    #[serde(default)]
    fields: HashMap<String, NamedField>,
}

#[derive(Deserialize)]
struct NamedField {
    #[serde(default)]
    name: String,
}

/// The fields of the issue that can be shown in its details, sorted by name.
#[tauri::command]
pub async fn get_ticket_fields(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
) -> Result<Vec<FieldRef>> {
    validate_key(&key)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .get(format!(
            "{}/rest/api/3/issue/{key}/editmeta",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;

    let body: EditMetaResponse = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    Ok(listed(body.fields))
}

fn listed(fields: HashMap<String, NamedField>) -> Vec<FieldRef> {
    let mut list: Vec<FieldRef> = fields
        .into_iter()
        .filter(|(key, _)| !SHOWN_ELSEWHERE.contains(&key.as_str()))
        .map(|(key, field)| FieldRef {
            name: if field.name.is_empty() {
                key.clone()
            } else {
                field.name
            },
            key,
        })
        .collect();
    list.sort_by_cached_key(|f| f.name.to_lowercase());
    list
}

#[derive(Deserialize)]
struct IssueResponse {
    #[serde(default)]
    fields: HashMap<String, Value>,
}

/// The values of the given fields on the issue, as lists of strings to display (empty when unset).
#[tauri::command]
pub async fn get_field_values(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    fields: Vec<String>,
) -> Result<HashMap<String, Vec<String>>> {
    validate_key(&key)?;
    if fields.is_empty() || !fields.iter().all(|f| is_field_key(f)) {
        return Err(AppError::new("invalidQuery", "Invalid field"));
    }
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .get(format!(
            "{}/rest/api/3/issue/{key}?fields={}",
            credentials.site,
            fields.join(",")
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;

    let body: IssueResponse = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    Ok(fields
        .into_iter()
        .map(|field| {
            let mut out = Vec::new();
            if let Some(value) = body.fields.get(&field) {
                flatten(value, &mut out);
            }
            (field, out)
        })
        .collect())
}

/// What an object is called: people, options, versions, sprints… each use a different property.
fn label_of(object: &serde_json::Map<String, Value>) -> Option<String> {
    ["displayName", "name", "value", "key", "title"]
        .iter()
        .find_map(|property| object.get(*property)?.as_str())
        .map(str::to_string)
}

/// Collects the text of an Atlassian Document Format node (what rich text fields hold).
fn adf_text(node: &Value, out: &mut String) {
    let kind = node.get("type").and_then(Value::as_str).unwrap_or_default();
    match kind {
        "text" => out.push_str(node.get("text").and_then(Value::as_str).unwrap_or_default()),
        "hardBreak" => out.push('\n'),
        _ => {}
    }
    for child in node
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        adf_text(child, out);
    }
    if matches!(
        kind,
        "paragraph" | "heading" | "listItem" | "codeBlock" | "blockquote" | "tableRow"
    ) && !out.ends_with('\n')
    {
        out.push('\n');
    }
}

fn push(out: &mut Vec<String>, text: &str) {
    let text = text.trim();
    if !text.is_empty() {
        out.push(text.chars().take(MAX_CHARS).collect());
    }
}

/// Turns any value of a field into strings to display: one per item for lists.
fn flatten(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Null => {}
        Value::String(text) => push(out, text),
        Value::Number(number) => out.push(number.to_string()),
        Value::Bool(yes) => out.push(if *yes { "Yes" } else { "No" }.to_string()),
        Value::Array(items) => items.iter().for_each(|item| flatten(item, out)),
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("doc") {
                let mut text = String::new();
                adf_text(value, &mut text);
                push(out, &text);
            } else if let Some(label) = label_of(object) {
                // Cascading selects: "Parent › Child"
                let mut parts = vec![label];
                let mut level = object.get("child").and_then(Value::as_object);
                while let Some(child) = level {
                    parts.extend(label_of(child));
                    level = child.get("child").and_then(Value::as_object);
                }
                push(out, &parts.join(" › "));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{NamedField, flatten, listed};

    fn shown(value: serde_json::Value) -> Vec<String> {
        let mut out = Vec::new();
        flatten(&value, &mut out);
        out
    }

    #[test]
    fn shows_the_kinds_of_values_jira_sends() {
        assert_eq!(shown(json!(null)), Vec::<String>::new());
        assert_eq!(shown(json!("  ")), Vec::<String>::new());
        assert_eq!(shown(json!(3.5)), ["3.5"]);
        assert_eq!(shown(json!(true)), ["Yes"]);
        // a select option, a person, a list of versions, sprints
        assert_eq!(shown(json!({ "id": "1", "value": "Alpha" })), ["Alpha"]);
        assert_eq!(
            shown(json!({ "accountId": "a", "displayName": "Jane" })),
            ["Jane"]
        );
        assert_eq!(
            shown(json!([{ "name": "1.0" }, { "name": "1.1" }])),
            ["1.0", "1.1"]
        );
        assert_eq!(
            shown(json!([{ "id": 4, "name": "Sprint 4", "state": "active" }])),
            ["Sprint 4"]
        );
        // a label list
        assert_eq!(shown(json!(["a", "b"])), ["a", "b"]);
        // a cascading select
        assert_eq!(
            shown(json!({ "value": "EU", "child": { "value": "France" } })),
            ["EU › France"]
        );
    }

    #[test]
    fn reads_the_text_of_rich_text_fields() {
        let doc = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "First" }] },
                { "type": "paragraph", "content": [
                    { "type": "text", "text": "Second " },
                    { "type": "text", "text": "line", "marks": [{ "type": "strong" }] },
                ] },
            ],
        });
        assert_eq!(shown(doc), ["First\nSecond line"]);
    }

    #[test]
    fn lists_fields_by_name_without_the_ones_shown_elsewhere() {
        let field = |name: &str| NamedField { name: name.into() };
        let list = listed(
            [
                ("priority".to_string(), field("Priority")),
                ("customfield_2".to_string(), field("beta")),
                ("customfield_1".to_string(), field("Alpha")),
                ("customfield_3".to_string(), field("")),
            ]
            .into(),
        );
        let keys: Vec<_> = list.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(keys, ["customfield_1", "customfield_2", "customfield_3"]);
        assert_eq!(list[2].name, "customfield_3");
    }
}
