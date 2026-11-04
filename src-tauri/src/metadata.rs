//! Editing the fields of issues.
//!
//! Which fields exist, what they are called and what they accept depends on the Jira site, the
//! project and the issue type (custom fields included), so nothing is hardcoded here: `get_edit_meta`
//! asks Jira what one issue lets the user edit and describes each field by the kind of editor it
//! needs. The UI offers a field only when every selected issue has it.

use std::collections::HashMap;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};

use crate::auth::load_credentials;
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;
use crate::workspace::valid_issue_key;

const MAX_USERS: &str = "20";

/// Fields that make no sense to set on several issues at once, or that need a rich editor.
const SKIPPED: &[&str] = &[
    "summary",
    "description",
    "issuetype",
    "project",
    "attachment",
    "comment",
    "issuelinks",
    "timetracking",
    "environment",
];

/// A value a field can take, e.g. one of the priorities of a project.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub name: String,
    pub icon_url: Option<String>,
}

/// What a field holds, which decides the editor the UI shows for it.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    /// One of `choices` (priority, select lists)
    Choice,
    /// Several of `choices`, added and removed one by one (components, versions, multi-selects)
    Choices,
    /// One line of text
    Text,
    /// Several lines of text, also the comment a transition asks for (only when moving a ticket:
    /// editing one needs rich text)
    LongText,
    Number,
    /// A duration to log as work on the issue (the "Time Spent" a transition can ask for)
    TimeSpent,
    /// `YYYY-MM-DD`
    Date,
    /// One person
    User,
    /// Several people, added and removed one by one
    Users,
    /// Free-form words, added and removed one by one
    Labels,
    /// The issue to put the issue under
    Parent,
}

/// A field of an issue that the current user can change.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditField {
    /// `priority`, `labels`, `customfield_10000`…
    pub key: String,
    /// As named in the user's Jira (so in the user's language)
    pub name: String,
    pub kind: FieldKind,
    /// What the issue accepts, for the kinds that pick from a list
    pub choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct EditMetaResponse {
    #[serde(default)]
    fields: HashMap<String, RawField>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RawField {
    #[serde(default)]
    name: String,
    schema: Option<RawSchema>,
    #[serde(default)]
    operations: Vec<String>,
    // Left untyped: options of different fields have different shapes (`name` or `value`)
    #[serde(default)]
    allowed_values: Vec<Value>,
    /// Transition screens only: the move is refused without a value…
    #[serde(default)]
    required: bool,
    /// …unless the field has one by default
    #[serde(default)]
    has_default_value: bool,
}

#[derive(Deserialize)]
struct RawSchema {
    #[serde(rename = "type")]
    kind: String,
    items: Option<String>,
    custom: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChoice {
    id: String,
    name: Option<String>,
    /// Select list options are named by `value`
    value: Option<String>,
    icon_url: Option<String>,
    /// Versions only
    #[serde(default)]
    archived: bool,
}

/// Fields a transition can't ask for in a form.
const TRANSITION_SKIPPED: &[&str] = &[
    "attachment",
    "issuelinks",
    "timetracking",
    "issuetype",
    "project",
];

/// The editor a field needs, `None` for the fields that can't be edited this way. When `moving`,
/// the field is on the screen of a transition (the values go in plain text, so long text and the
/// comment can be filled in too); otherwise it is edited in bulk, where they can't.
fn classify(key: &str, field: &RawField, moving: bool) -> Option<FieldKind> {
    if if moving { TRANSITION_SKIPPED } else { SKIPPED }.contains(&key) {
        return None;
    }
    if moving && key == "comment" {
        return Some(FieldKind::LongText);
    }
    if moving && key == "worklog" {
        return Some(FieldKind::TimeSpent);
    }
    let schema = field.schema.as_ref()?;
    // Lists are changed by adding and removing values; one that can only be replaced as a whole
    // would wipe what each issue has. A transition only ever adds to what is there.
    let incremental = moving
        || ["add", "remove"]
            .iter()
            .all(|op| field.operations.iter().any(|o| o == op));
    let custom = schema.custom.as_deref().unwrap_or_default();

    match (schema.kind.as_str(), schema.items.as_deref()) {
        ("issuelink", _) if key == "parent" => Some(FieldKind::Parent),
        ("user", _) => Some(FieldKind::User),
        ("priority" | "option" | "resolution", _) => Some(FieldKind::Choice),
        ("number", _) => Some(FieldKind::Number),
        ("date", _) => Some(FieldKind::Date),
        ("string", _)
            if moving
                && (custom.ends_with(":textarea")
                    || matches!(key, "description" | "environment")) =>
        {
            Some(FieldKind::LongText)
        }
        ("string", _)
            if custom.ends_with(":textfield")
                || custom.ends_with(":url")
                || (moving && key == "summary") =>
        {
            Some(FieldKind::Text)
        }
        ("array", Some("user")) if incremental => Some(FieldKind::Users),
        ("array", Some("string")) if incremental => Some(FieldKind::Labels),
        ("array", Some("option" | "component" | "version")) if incremental => {
            Some(FieldKind::Choices)
        }
        _ => None,
    }
}

fn choices_of(field: RawField) -> Vec<Choice> {
    field
        .allowed_values
        .into_iter()
        .filter_map(|v| serde_json::from_value::<RawChoice>(v).ok())
        .filter(|c| !c.archived)
        .filter_map(|c| {
            Some(Choice {
                name: c.name.or(c.value)?,
                id: c.id,
                icon_url: c.icon_url,
            })
        })
        .collect()
}

fn name_of(key: &str, field: &RawField) -> String {
    if field.name.is_empty() {
        key.to_string()
    } else {
        field.name.clone()
    }
}

/// The field as the UI edits it, `None` when it can't be (see `classify`).
fn describe(key: String, field: RawField, moving: bool) -> Option<EditField> {
    let kind = classify(&key, &field, moving)?;
    let name = name_of(&key, &field);
    let choices = choices_of(field);
    // A list to pick from with nothing in it can't be used
    if matches!(kind, FieldKind::Choice | FieldKind::Choices) && choices.is_empty() {
        return None;
    }
    Some(EditField {
        key,
        name,
        kind,
        choices,
    })
}

fn edit_fields(fields: HashMap<String, RawField>) -> Vec<EditField> {
    fields
        .into_iter()
        .filter_map(|(key, field)| describe(key, field, false))
        .collect()
}

/// The fields on the screen of a transition, sorted by name.
#[derive(Debug, Default)]
pub(crate) struct Screen {
    /// What Jira insists on (required, no default), as editors to show
    pub required: Vec<EditField>,
    /// The other fields of the screen. Jira's workflow can still insist on some of them without
    /// saying so (a validator), which only its refusal reveals.
    pub optional: Vec<EditField>,
    /// Names of required fields that can't be filled in here
    pub unsupported: Vec<String>,
}

pub(crate) fn screen_fields(fields: HashMap<String, RawField>) -> Screen {
    let mut screen = Screen::default();
    for (key, field) in fields {
        let required = field.required && !field.has_default_value;
        let name = name_of(&key, &field);
        match (describe(key, field, true), required) {
            (Some(described), true) => screen.required.push(described),
            (Some(described), false) => screen.optional.push(described),
            (None, true) => screen.unsupported.push(name),
            (None, false) => {}
        }
    }
    screen
        .required
        .sort_by_cached_key(|f| f.name.to_lowercase());
    screen
        .optional
        .sort_by_cached_key(|f| f.name.to_lowercase());
    screen
        .unsupported
        .sort_by_cached_key(|name| name.to_lowercase());
    screen
}

/// The fields of the issue that the current user can edit, and what each accepts.
#[tauri::command]
pub async fn get_edit_meta(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
) -> Result<Vec<EditField>> {
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

    Ok(edit_fields(body.fields))
}

/// What values a list field is changed by.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Items {
    /// Plain strings
    Labels,
    /// Options, components, versions: by id
    Choices,
    /// People: by account id
    Users,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    SetChoice {
        id: String,
    },
    /// Empty text clears the field
    SetText {
        text: String,
    },
    SetNumber {
        number: Option<f64>,
    },
    /// `YYYY-MM-DD`
    SetDate {
        day: Option<String>,
    },
    SetUser {
        account_id: Option<String>,
    },
    SetParent {
        issue_key: String,
    },
    /// Adds a comment (plain text) while moving an issue
    AddComment {
        text: String,
    },
    /// Logs work while moving an issue
    AddWorklog {
        seconds: u64,
    },
    Modify {
        items: Items,
        add: Vec<String>,
        remove: Vec<String>,
    },
}

/// One change to make on an issue's field.
#[derive(Deserialize)]
pub struct FieldChange {
    key: String,
    #[serde(flatten)]
    op: Op,
}

fn is_numeric_id(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

fn is_day(s: &str) -> bool {
    const SHAPE: &[u8; 10] = b"dddd-dd-dd";
    s.len() == SHAPE.len()
        && s.bytes().zip(SHAPE).all(|(b, shape)| match shape {
            b'd' => b.is_ascii_digit(),
            literal => b == *literal,
        })
}

/// Account ids are opaque (`5b10ac8d…`, or `557058:f58131cb-…` for older ones).
fn is_account_id(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_'))
}

/// Jira labels are single words.
fn is_label(s: &str) -> bool {
    !s.is_empty() && s.len() <= 255 && !s.chars().any(char::is_whitespace)
}

/// `customfield_10000`, `priority`…: the key is the name of a property in the request.
pub(crate) fn is_field_key(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The body of the edit request (`fields` and `update`, which a transition takes too), after
/// checking everything that ends up in it.
pub(crate) fn edit_body(changes: &[FieldChange]) -> Result<Value> {
    let invalid = |what: &str| AppError::new("invalidQuery", format!("Invalid {what}"));
    let mut fields = Map::new();
    let mut update = Map::new();

    for FieldChange { key, op } in changes {
        if !is_field_key(key) {
            return Err(invalid("field"));
        }
        match op {
            Op::SetChoice { id } => {
                if !is_numeric_id(id) {
                    return Err(invalid("choice"));
                }
                fields.insert(key.clone(), json!({ "id": id }));
            }
            Op::SetText { text } => {
                let value = if text.trim().is_empty() {
                    Value::Null
                } else {
                    json!(text.trim())
                };
                fields.insert(key.clone(), value);
            }
            Op::SetNumber { number } => {
                let value = match number {
                    None => Value::Null,
                    Some(n) => Number::from_f64(*n)
                        .map(Value::Number)
                        .ok_or_else(|| invalid("number"))?,
                };
                fields.insert(key.clone(), value);
            }
            Op::SetDate { day } => {
                let value = match day {
                    None => Value::Null,
                    Some(day) if is_day(day) => json!(day),
                    Some(_) => return Err(invalid("date")),
                };
                fields.insert(key.clone(), value);
            }
            Op::SetUser { account_id } => {
                let value = match account_id {
                    None => Value::Null,
                    Some(id) if is_account_id(id) => json!({ "accountId": id }),
                    Some(_) => return Err(invalid("person")),
                };
                fields.insert(key.clone(), value);
            }
            Op::SetParent { issue_key } => {
                if !valid_issue_key(issue_key) {
                    return Err(invalid("parent"));
                }
                fields.insert(key.clone(), json!({ "key": issue_key }));
            }
            Op::AddComment { text } => {
                if text.trim().is_empty() {
                    return Err(invalid("comment"));
                }
                update.insert(key.clone(), json!([{ "add": { "body": text.trim() } }]));
            }
            Op::AddWorklog { seconds } => {
                // Jira doesn't log less than a minute
                if *seconds < 60 {
                    return Err(invalid("time spent"));
                }
                update.insert(
                    key.clone(),
                    json!([{ "add": { "timeSpentSeconds": seconds } }]),
                );
            }
            Op::Modify { items, add, remove } => {
                let mut operations = Vec::new();
                for (verb, list) in [("add", add), ("remove", remove)] {
                    for value in list {
                        let operand = match items {
                            Items::Labels if is_label(value) => json!(value),
                            Items::Choices if is_numeric_id(value) => json!({ "id": value }),
                            Items::Users if is_account_id(value) => json!({ "accountId": value }),
                            _ => return Err(invalid("value")),
                        };
                        operations.push(json!({ verb: operand }));
                    }
                }
                if !operations.is_empty() {
                    update.insert(key.clone(), Value::Array(operations));
                }
            }
        }
    }

    let mut body = Map::new();
    if !fields.is_empty() {
        body.insert("fields".into(), Value::Object(fields));
    }
    if !update.is_empty() {
        body.insert("update".into(), Value::Object(update));
    }
    if body.is_empty() {
        return Err(AppError::new("invalidQuery", "Nothing to change"));
    }
    Ok(Value::Object(body))
}

/// Applies the changes to one issue. Jira refuses the whole edit with a readable message when a
/// value isn't allowed on that issue, which is passed on as the error.
#[tauri::command]
pub async fn update_issue_fields(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    changes: Vec<FieldChange>,
) -> Result<()> {
    validate_key(&key)?;
    let body = edit_body(&changes)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let response = http
        .put(format!("{}/rest/api/3/issue/{key}", credentials.site))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .json(&body)
        .send()
        .await
        .map_err(AppError::network)?;
    ensure_ok(response).await?;

    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub account_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawUser {
    account_id: String,
    display_name: String,
    active: Option<bool>,
    /// `atlassian` for people; apps and bots are something else
    account_type: Option<String>,
    avatar_urls: Option<HashMap<String, String>>,
}

fn is_project_key(s: &str) -> bool {
    s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// People who can be assigned issues in every one of the projects, matching `query` on name or email.
#[tauri::command]
pub async fn search_assignable_users(
    http: tauri::State<'_, reqwest::Client>,
    project_keys: Vec<String>,
    query: String,
) -> Result<Vec<User>> {
    if project_keys.is_empty() || !project_keys.iter().all(|k| is_project_key(k)) {
        return Err(AppError::new("invalidQuery", "Invalid project key"));
    }
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let url = Url::parse_with_params(
        &format!(
            "{}/rest/api/3/user/assignable/multiProjectSearch",
            credentials.site
        ),
        [
            ("projectKeys", project_keys.join(",").as_str()),
            ("query", query.trim()),
            ("maxResults", MAX_USERS),
        ],
    )
    .map_err(|_| AppError::new("invalidQuery", "Invalid search"))?;

    fetch_users(&http, &credentials, url).await
}

/// People who can see the issue, so who can be mentioned in a comment on it, matching `query` on name or email.
#[tauri::command]
pub async fn search_mentionable_users(
    http: tauri::State<'_, reqwest::Client>,
    key: String,
    query: String,
) -> Result<Vec<User>> {
    validate_key(&key)?;
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let url = Url::parse_with_params(
        &format!("{}/rest/api/3/user/viewissue/search", credentials.site),
        [
            ("issueKey", key.as_str()),
            ("query", query.trim()),
            ("maxResults", MAX_USERS),
        ],
    )
    .map_err(|_| AppError::new("invalidQuery", "Invalid search"))?;

    fetch_users(&http, &credentials, url).await
}

/// The active people (not apps) of a Jira user search.
async fn fetch_users(
    http: &reqwest::Client,
    credentials: &crate::auth::Credentials,
    url: Url,
) -> Result<Vec<User>> {
    let response = http
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
        .map_err(AppError::network)?;
    let response = ensure_ok(response).await?;

    let users: Vec<RawUser> = response
        .json()
        .await
        .map_err(|e| AppError::new("unexpected", format!("Unreadable response from Jira: {e}")))?;

    Ok(users
        .into_iter()
        .filter(|u| u.active != Some(false))
        .filter(|u| u.account_type.as_deref().is_none_or(|t| t == "atlassian"))
        .map(|u| User {
            account_id: u.account_id,
            display_name: u.display_name,
            avatar_url: u.avatar_urls.and_then(|mut urls| urls.remove("48x48")),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        EditMetaResponse, FieldChange, FieldKind, edit_body, edit_fields, is_account_id, is_day,
        is_field_key, is_label, is_project_key, screen_fields,
    };

    #[test]
    fn finds_what_a_transition_requires() {
        let screen: EditMetaResponse = serde_json::from_value(json!({
            "fields": {
                "resolution": { "required": true, "name": "Résolution", "schema": { "type": "resolution", "system": "resolution" },
                    "operations": ["set"], "allowedValues": [{ "id": "10000", "name": "Done" }] },
                "comment": { "required": true, "name": "Comment", "schema": { "type": "comments-page", "system": "comment" }, "operations": ["add"] },
                "customfield_6": { "required": true, "name": "Notes", "schema": { "type": "string", "custom": "x:textarea" }, "operations": ["set"] },
                "customfield_9": { "required": true, "name": "Sprint", "schema": { "type": "array", "items": "json", "custom": "x:gh-sprint" }, "operations": ["set"] },
                "customfield_8": { "required": true, "hasDefaultValue": true, "name": "Defaulted", "schema": { "type": "option" },
                    "operations": ["set"], "allowedValues": [{ "id": "1", "value": "x" }] },
                "customfield_7": { "required": false, "name": "Optional", "schema": { "type": "number" }, "operations": ["set"] },
            }
        }))
        .unwrap();
        let screen = screen_fields(screen.fields);
        let (required, unsupported) = (&screen.required, &screen.unsupported);
        let summary: Vec<_> = required.iter().map(|f| (f.name.as_str(), f.kind)).collect();
        assert_eq!(
            summary,
            [
                ("Comment", FieldKind::LongText),
                ("Notes", FieldKind::LongText),
                ("Résolution", FieldKind::Choice),
            ]
        );
        assert_eq!(required[2].choices.len(), 1);
        assert_eq!(unsupported, &["Sprint"]);
        // not required, or required with a default: Jira may still insist on them, so they are offered
        let optional: Vec<_> = screen.optional.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(optional, ["Defaulted", "Optional"]);
    }

    #[test]
    fn offers_time_spent_and_logs_it_as_work() {
        let screen: EditMetaResponse = serde_json::from_value(json!({
            "fields": {
                "worklog": { "required": false, "name": "Journal de travail", "schema": { "type": "array", "items": "worklog", "system": "worklog" }, "operations": ["add"] },
            }
        }))
        .unwrap();
        let screen = screen_fields(screen.fields);
        assert_eq!(screen.optional.len(), 1);
        assert_eq!(screen.optional[0].kind, FieldKind::TimeSpent);

        let work: Vec<FieldChange> = serde_json::from_value(
            json!([{ "key": "worklog", "op": "addWorklog", "seconds": 5400 }]),
        )
        .unwrap();
        assert_eq!(
            edit_body(&work).unwrap(),
            json!({ "update": { "worklog": [{ "add": { "timeSpentSeconds": 5400 } }] } })
        );
        let short: Vec<FieldChange> = serde_json::from_value(
            json!([{ "key": "worklog", "op": "addWorklog", "seconds": 30 }]),
        )
        .unwrap();
        assert!(edit_body(&short).is_err());
    }

    #[test]
    fn a_comment_goes_in_the_update_part() {
        let changes: Vec<FieldChange> = serde_json::from_value(
            json!([{ "key": "comment", "op": "addComment", "text": "Done" }]),
        )
        .unwrap();
        assert_eq!(
            edit_body(&changes).unwrap(),
            json!({ "update": { "comment": [{ "add": { "body": "Done" } }] } })
        );
        let empty: Vec<FieldChange> =
            serde_json::from_value(json!([{ "key": "comment", "op": "addComment", "text": " " }]))
                .unwrap();
        assert!(edit_body(&empty).is_err());
    }

    fn changes(value: serde_json::Value) -> Vec<FieldChange> {
        serde_json::from_value(value).unwrap()
    }

    /// The shapes Jira Cloud really sends for a few kinds of fields
    fn sample() -> HashMap<String, (String, FieldKind, usize)> {
        let meta: EditMetaResponse = serde_json::from_value(json!({
            "fields": {
                "summary": { "name": "Summary", "schema": { "type": "string", "system": "summary" }, "operations": ["set"] },
                "priority": { "name": "Priorité", "schema": { "type": "priority", "system": "priority" }, "operations": ["set"],
                    "allowedValues": [{ "id": "1", "name": "High", "iconUrl": "x" }, { "id": "2", "name": "Low" }] },
                "labels": { "name": "Labels", "schema": { "type": "array", "items": "string", "system": "labels" }, "operations": ["add", "set", "remove"] },
                "fixVersions": { "name": "Fix", "schema": { "type": "array", "items": "version", "system": "fixVersions" }, "operations": ["set", "add", "remove"],
                    "allowedValues": [{ "id": "7", "name": "1.0" }, { "id": "8", "name": "0.9", "archived": true }] },
                "customfield_1": { "name": "Dev Team", "schema": { "type": "option", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:select" }, "operations": ["set"],
                    "allowedValues": [{ "id": "10", "value": "Alpha" }] },
                "customfield_2": { "name": "Customers", "schema": { "type": "array", "items": "option", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:multiselect" }, "operations": ["add", "set", "remove"],
                    "allowedValues": [{ "id": "20", "value": "Acme" }] },
                "customfield_3": { "name": "Notes", "schema": { "type": "string", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:textarea" }, "operations": ["set"] },
                "customfield_4": { "name": "Sprint", "schema": { "type": "array", "items": "json", "custom": "com.pyxis.greenhopper.jira:gh-sprint" }, "operations": ["set"] },
                "customfield_5": { "name": "Points", "schema": { "type": "number", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:float" }, "operations": ["set"] },
                "customfield_6": { "name": "Flags", "schema": { "type": "array", "items": "option" }, "operations": ["set"],
                    "allowedValues": [{ "id": "30", "value": "Impediment" }] },
                "customfield_7": { "name": "Empty list", "schema": { "type": "option" }, "operations": ["set"] },
                "parent": { "name": "Parent", "schema": { "type": "issuelink", "system": "parent" }, "operations": ["set"] },
                "assignee": { "name": "Assignee", "schema": { "type": "user", "system": "assignee" }, "operations": ["set"] },
                "customfield_8": { "name": "Reviewers", "schema": { "type": "array", "items": "user", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker" }, "operations": ["add", "set", "remove"] },
                "duedate": { "name": "Due", "schema": { "type": "date", "system": "duedate" }, "operations": ["set"] },
            }
        }))
        .unwrap();
        edit_fields(meta.fields)
            .into_iter()
            .map(|f| (f.key, (f.name, f.kind, f.choices.len())))
            .collect()
    }

    #[test]
    fn describes_the_fields_jira_says_are_editable() {
        let fields = sample();
        let kind = |key: &str| fields.get(key).map(|f| f.1);
        assert_eq!(kind("priority"), Some(FieldKind::Choice));
        assert_eq!(kind("labels"), Some(FieldKind::Labels));
        assert_eq!(kind("fixVersions"), Some(FieldKind::Choices));
        assert_eq!(kind("customfield_1"), Some(FieldKind::Choice));
        assert_eq!(kind("customfield_2"), Some(FieldKind::Choices));
        assert_eq!(kind("customfield_5"), Some(FieldKind::Number));
        assert_eq!(kind("parent"), Some(FieldKind::Parent));
        assert_eq!(kind("assignee"), Some(FieldKind::User));
        assert_eq!(kind("customfield_8"), Some(FieldKind::Users));
        assert_eq!(kind("duedate"), Some(FieldKind::Date));
    }

    #[test]
    fn leaves_out_what_cannot_be_edited_in_bulk() {
        let fields = sample();
        assert!(!fields.contains_key("summary")); // one summary for many tickets makes no sense
        assert!(!fields.contains_key("customfield_3")); // rich text
        assert!(!fields.contains_key("customfield_4")); // sprint: needs another API
        assert!(!fields.contains_key("customfield_6")); // a list that can only be replaced as a whole
        assert!(!fields.contains_key("customfield_7")); // nothing to pick from
    }

    #[test]
    fn names_choices_and_skips_archived_versions() {
        let fields = sample();
        assert_eq!(fields["priority"].0, "Priorité");
        assert_eq!(fields["priority"].2, 2);
        assert_eq!(fields["fixVersions"].2, 1);
        assert_eq!(fields["customfield_1"].2, 1); // named by `value`
    }

    #[test]
    fn checks_what_goes_into_the_request() {
        assert!(is_day("2026-11-03"));
        assert!(!is_day("2026-11-3"));
        assert!(!is_day("03/11/2026"));
        assert!(is_account_id("557058:f58131cb-b67d-43c7-b30d-6b58d40bd077"));
        assert!(!is_account_id("a b"));
        assert!(!is_account_id(""));
        assert!(is_label("backend"));
        assert!(!is_label("two words"));
        assert!(!is_label(""));
        assert!(is_project_key("ES"));
        assert!(!is_project_key("es"));
        assert!(!is_project_key("ES,AB"));
        assert!(is_field_key("customfield_10000"));
        assert!(!is_field_key("a.b"));
        assert!(!is_field_key(""));
    }

    #[test]
    fn builds_the_edit_request() {
        let body = edit_body(&changes(json!([
            { "key": "priority", "op": "setChoice", "id": "3" },
            { "key": "duedate", "op": "setDate", "day": null },
            { "key": "assignee", "op": "setUser", "accountId": null },
            { "key": "customfield_9", "op": "setNumber", "number": 2.5 },
            { "key": "customfield_10", "op": "setText", "text": "  " },
            { "key": "parent", "op": "setParent", "issueKey": "ABC-12" },
            { "key": "labels", "op": "modify", "items": "labels", "add": ["a"], "remove": ["b"] },
            { "key": "components", "op": "modify", "items": "choices", "add": ["10"], "remove": [] },
            { "key": "customfield_8", "op": "modify", "items": "users", "add": ["abc123"], "remove": [] },
        ])))
        .unwrap();
        assert_eq!(
            body,
            json!({
                "fields": {
                    "priority": { "id": "3" },
                    "duedate": null,
                    "assignee": null,
                    "customfield_9": 2.5,
                    "customfield_10": null,
                    "parent": { "key": "ABC-12" },
                },
                "update": {
                    "labels": [{ "add": "a" }, { "remove": "b" }],
                    "components": [{ "add": { "id": "10" } }],
                    "customfield_8": [{ "add": { "accountId": "abc123" } }],
                },
            })
        );
    }

    #[test]
    fn refuses_empty_and_malformed_changes() {
        let refused = |value| edit_body(&changes(value)).is_err();
        assert!(refused(json!([])));
        assert!(refused(
            json!([{ "key": "priority", "op": "setChoice", "id": "high" }])
        ));
        assert!(refused(
            json!([{ "key": "duedate", "op": "setDate", "day": "tomorrow" }])
        ));
        assert!(refused(
            json!([{ "key": "parent", "op": "setParent", "issueKey": "abc-12" }])
        ));
        assert!(refused(
            json!([{ "key": "a.b", "op": "setText", "text": "x" }])
        ));
        assert!(refused(
            json!([{ "key": "labels", "op": "modify", "items": "labels", "add": ["two words"], "remove": [] }])
        ));
        assert!(refused(
            json!([{ "key": "c", "op": "modify", "items": "choices", "add": ["backend"], "remove": [] }])
        ));
        assert!(refused(
            json!([{ "key": "c", "op": "modify", "items": "users", "add": [], "remove": [] }])
        ));
    }
}
