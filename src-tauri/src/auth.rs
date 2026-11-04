use std::time::Duration;

use crate::error::{AppError, Result};
use keyring::Entry;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "com.tracket.app";
const KEYRING_USER: &str = "jira-credentials";

/// Everything needed to call Jira, stored as one JSON blob in the OS keychain.
/// The token never leaves the Rust side.
#[derive(Serialize, Deserialize, Clone)]
pub struct Credentials {
    pub site: String,
    pub email: String,
    pub token: String,
}

/// What the UI is allowed to know about the signed-in user.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub site: String,
    pub email: String,
    pub account_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Myself {
    account_id: String,
    display_name: String,
    avatar_urls: Option<std::collections::HashMap<String, String>>,
}

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Tracket/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
}

/// Accepts `acme`, `acme.atlassian.net` or a full URL and returns `https://host`.
fn normalize_site(input: &str) -> Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "invalidSite",
            "Enter your Jira site, e.g. acme.atlassian.net",
        ));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else if trimmed.contains('.') {
        format!("https://{trimmed}")
    } else {
        format!("https://{trimmed}.atlassian.net")
    };
    let url = Url::parse(&with_scheme)
        .map_err(|_| AppError::new("invalidSite", "This doesn't look like a valid site address"))?;
    if url.scheme() != "https" {
        return Err(AppError::new("invalidSite", "The site must use https"));
    }
    let host = url.host_str().ok_or_else(|| {
        AppError::new("invalidSite", "This doesn't look like a valid site address")
    })?;
    Ok(format!("https://{host}"))
}

fn keyring_entry() -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::new("keychain", e.to_string()))
}

pub fn load_credentials() -> Result<Option<Credentials>> {
    match keyring_entry()?.get_password() {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| {
            AppError::new(
                "keychain",
                format!("Stored credentials are unreadable: {e}"),
            )
        }),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::new("keychain", e.to_string())),
    }
}

fn save_credentials(credentials: &Credentials) -> Result<()> {
    let json =
        serde_json::to_string(credentials).map_err(|e| AppError::new("keychain", e.to_string()))?;
    keyring_entry()?
        .set_password(&json)
        .map_err(|e| AppError::new("keychain", e.to_string()))
}

fn delete_credentials() -> Result<()> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::new("keychain", e.to_string())),
    }
}

/// Calls `GET /rest/api/3/myself`, which doubles as the credentials check.
async fn fetch_session(http: &reqwest::Client, credentials: &Credentials) -> Result<Session> {
    let response = http
        .get(format!("{}/rest/api/3/myself", credentials.site))
        .basic_auth(&credentials.email, Some(&credentials.token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(AppError::network)?;

    match response.status() {
        StatusCode::OK => {}
        StatusCode::UNAUTHORIZED => {
            return Err(AppError::new(
                "invalidCredentials",
                "Invalid email or API token",
            ));
        }
        StatusCode::FORBIDDEN => {
            return Err(AppError::new(
                "forbidden",
                "Jira refused the request (403). Is the token allowed on this site?",
            ));
        }
        StatusCode::NOT_FOUND => {
            return Err(AppError::new(
                "invalidSite",
                "No Jira Cloud site found at this address",
            ));
        }
        status => {
            return Err(AppError::new(
                "unexpected",
                format!("Unexpected response from Jira: {status}"),
            ));
        }
    }

    let me: Myself = response.json().await.map_err(|_| {
        AppError::new(
            "invalidSite",
            "This address didn't answer like a Jira Cloud site",
        )
    })?;

    Ok(Session {
        site: credentials.site.clone(),
        email: credentials.email.clone(),
        account_id: me.account_id,
        display_name: me.display_name,
        avatar_url: me.avatar_urls.and_then(|mut urls| urls.remove("48x48")),
    })
}

#[tauri::command]
pub async fn login(
    http: tauri::State<'_, reqwest::Client>,
    site: String,
    email: String,
    token: String,
) -> Result<Session> {
    let email = email.trim().to_string();
    let token = token.trim().to_string();
    if email.is_empty() || token.is_empty() {
        return Err(AppError::new(
            "invalidCredentials",
            "Email and API token are required",
        ));
    }
    let credentials = Credentials {
        site: normalize_site(&site)?,
        email,
        token,
    };
    let session = fetch_session(&http, &credentials).await?;
    save_credentials(&credentials)?;
    Ok(session)
}

/// `None` when nobody is signed in; an error when stored credentials no longer work.
#[tauri::command]
pub async fn current_session(http: tauri::State<'_, reqwest::Client>) -> Result<Option<Session>> {
    match load_credentials()? {
        Some(credentials) => fetch_session(&http, &credentials).await.map(Some),
        None => Ok(None),
    }
}

/// Signs out: forgets the API token, then wipes everything else the app keeps on this computer
/// (settings, timers, linked folders, cached pages: all the webview's storage), so the next person
/// to sign in, on this site or another, starts from nothing.
#[tauri::command]
pub fn logout(window: tauri::WebviewWindow) -> Result<()> {
    delete_credentials()?;
    window
        .clear_all_browsing_data()
        .map_err(|e| AppError::new("unexpected", format!("Couldn't erase the local data: {e}")))
}

#[cfg(test)]
mod tests {
    use super::normalize_site;

    #[test]
    fn normalizes_site_inputs() {
        assert_eq!(
            normalize_site("acme").unwrap(),
            "https://acme.atlassian.net"
        );
        assert_eq!(
            normalize_site(" acme.atlassian.net ").unwrap(),
            "https://acme.atlassian.net"
        );
        assert_eq!(
            normalize_site("https://acme.atlassian.net/jira/your-work").unwrap(),
            "https://acme.atlassian.net"
        );
        assert!(normalize_site("http://acme.atlassian.net").is_err());
        assert!(normalize_site("").is_err());
    }
}
