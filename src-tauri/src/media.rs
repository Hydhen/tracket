//! `jira://` protocol: lets the webview load Jira images (attachments, emoji, avatars)
//! that need authentication, without ever exposing the token to the UI.

use tauri::http::{Response, StatusCode};
use tauri::{Manager, UriSchemeContext, UriSchemeResponder};

use crate::auth::load_credentials;

/// Only these Jira paths can be proxied.
const ALLOWED_PREFIXES: [&str; 4] = ["/rest/api/", "/secure/", "/images/", "/download/"];

fn is_allowed(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    ALLOWED_PREFIXES.iter().any(|p| lower.starts_with(p))
        && !lower.contains("..")
        && !lower.contains("%2e")
        && !lower.contains("//")
        && !lower.contains('\\')
}

fn error(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("static response")
}

async fn fetch(http: &reqwest::Client, path_and_query: &str) -> Response<Vec<u8>> {
    let Ok(Some(credentials)) = load_credentials() else {
        return error(StatusCode::UNAUTHORIZED);
    };
    // The host is always the signed-in site, so this can't be pointed elsewhere
    let url = format!("{}{}", credentials.site, path_and_query);
    // reqwest drops the Authorization header when Jira redirects to its media host
    let Ok(upstream) = http
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .send()
        .await
    else {
        return error(StatusCode::BAD_GATEWAY);
    };

    let status = upstream.status().as_u16();
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let Ok(bytes) = upstream.bytes().await else {
        return error(StatusCode::BAD_GATEWAY);
    };

    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        // Attachments can be confidential: the webview must not keep a copy of them on disk
        .header("Cache-Control", "no-store")
        .body(bytes.to_vec())
        .unwrap_or_else(|_| error(StatusCode::INTERNAL_SERVER_ERROR))
}

pub fn handle<R: tauri::Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let path = request.uri().path().to_string();
    if request.method() != tauri::http::Method::GET || !is_allowed(&path) {
        responder.respond(error(StatusCode::FORBIDDEN));
        return;
    }
    let path_and_query = match request.uri().query() {
        Some(q) => format!("{path}?{q}"),
        None => path,
    };

    let http = ctx.app_handle().state::<reqwest::Client>().inner().clone();
    tauri::async_runtime::spawn(async move {
        responder.respond(fetch(&http, &path_and_query).await);
    });
}

#[cfg(test)]
mod tests {
    use super::is_allowed;

    #[test]
    fn only_allows_known_jira_paths() {
        assert!(is_allowed("/rest/api/3/attachment/content/123"));
        assert!(is_allowed("/secure/attachment/123/shot.png"));
        assert!(!is_allowed("/rest/api/../../admin"));
        assert!(!is_allowed("/rest/api/%2e%2e/admin"));
        assert!(!is_allowed("//evil.example/x"));
        assert!(!is_allowed("/admin"));
    }
}
