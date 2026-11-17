//! `jira://` protocol: lets the webview load Jira images and videos (attachments, emoji, avatars)
//! that need authentication, without ever exposing the token to the UI.

use reqwest::header::{ACCEPT_RANGES, CONTENT_RANGE, CONTENT_TYPE, RANGE};
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

/// Answers are held in memory, so a video is handed out in pieces of at most this size: the player asks for
/// `bytes=0-` (all of it) and comes back for the next piece when it needs it.
const CHUNK: u64 = 8 * 1024 * 1024;

/// The range to ask Jira for, cut down to `CHUNK` bytes. Several ranges at once aren't passed on.
fn bounded_range(value: &str) -> Option<String> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = (start.trim(), end.trim());
    if start.is_empty() {
        // The last bytes of the file, where some videos keep their index
        let last: u64 = end.parse().ok()?;
        return Some(format!("bytes=-{}", last.min(CHUNK)));
    }
    let start: u64 = start.parse().ok()?;
    let limit = start.saturating_add(CHUNK - 1);
    let end = match end.parse::<u64>() {
        Ok(end) if end < limit => end,
        _ => limit,
    };
    Some(format!("bytes={start}-{end}"))
}

fn error(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("static response")
}

async fn fetch(http: &reqwest::Client, path_and_query: &str, range: Option<String>) -> Response<Vec<u8>> {
    let Ok(Some(credentials)) = load_credentials() else {
        return error(StatusCode::UNAUTHORIZED);
    };
    // The host is always the signed-in site, so this can't be pointed elsewhere
    let url = format!("{}{}", credentials.site, path_and_query);
    // reqwest drops the Authorization header when Jira redirects to its media host
    let mut request = http
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token));
    if let Some(range) = range {
        request = request.header(RANGE, range);
    }
    let Ok(upstream) = request.send().await else {
        return error(StatusCode::BAD_GATEWAY);
    };

    let status = upstream.status().as_u16();
    let header = |name| {
        upstream
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let content_type = header(CONTENT_TYPE).unwrap_or_else(|| "application/octet-stream".to_string());
    let content_range = header(CONTENT_RANGE);
    let accept_ranges = header(ACCEPT_RANGES);
    let Ok(bytes) = upstream.bytes().await else {
        return error(StatusCode::BAD_GATEWAY);
    };

    let mut response = Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        // Attachments can be confidential: the webview must not keep a copy of them on disk
        .header("Cache-Control", "no-store");
    // What lets a player seek: which part of the file this is, and that parts can be asked for
    if let Some(value) = content_range {
        response = response.header("Content-Range", value);
    }
    if let Some(value) = accept_ranges {
        response = response.header("Accept-Ranges", value);
    }
    response
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

    let range = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .and_then(bounded_range);

    let http = ctx.app_handle().state::<reqwest::Client>().inner().clone();
    tauri::async_runtime::spawn(async move {
        responder.respond(fetch(&http, &path_and_query, range).await);
    });
}

#[cfg(test)]
mod tests {
    use super::{CHUNK, bounded_range, is_allowed};

    #[test]
    fn only_allows_known_jira_paths() {
        assert!(is_allowed("/rest/api/3/attachment/content/123"));
        assert!(is_allowed("/secure/attachment/123/shot.png"));
        assert!(!is_allowed("/rest/api/../../admin"));
        assert!(!is_allowed("/rest/api/%2e%2e/admin"));
        assert!(!is_allowed("//evil.example/x"));
        assert!(!is_allowed("/admin"));
    }

    #[test]
    fn cuts_ranges_down_to_a_piece() {
        // A player asks for everything: it gets the first piece
        assert_eq!(bounded_range("bytes=0-"), Some(format!("bytes=0-{}", CHUNK - 1)));
        assert_eq!(bounded_range("bytes=100-"), Some(format!("bytes=100-{}", 100 + CHUNK - 1)));
        // A small range is left alone, a huge one is cut
        assert_eq!(bounded_range("bytes=10-20"), Some("bytes=10-20".to_string()));
        assert_eq!(bounded_range("bytes=0-999999999999"), Some(format!("bytes=0-{}", CHUNK - 1)));
        // The end of the file
        assert_eq!(bounded_range("bytes=-500"), Some("bytes=-500".to_string()));
        assert_eq!(bounded_range("bytes=-999999999999"), Some(format!("bytes=-{CHUNK}")));
        // Not understood or several at once: no range at all
        assert_eq!(bounded_range("bytes=0-10,20-30"), None);
        assert_eq!(bounded_range("items=0-10"), None);
        assert_eq!(bounded_range("bytes=abc-"), None);
    }
}
