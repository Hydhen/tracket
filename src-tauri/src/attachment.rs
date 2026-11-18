//! Attaching files to a ticket.
//!
//! Jira wiki markup can only show an image that is attached to the ticket (`!shot.png!`), so an image pasted into a
//! comment or a description is attached first and then referred to by its name.

use reqwest::header::CONTENT_TYPE;
use tauri::ipc::{InvokeBody, Request};

use crate::auth::load_credentials;
use crate::detail::validate_key;
use crate::error::{AppError, Result};
use crate::jira::ensure_ok;

/// The longest file name accepted
const MAX_NAME: usize = 100;

/// Names are written in wiki markup and in a header: plain characters only, so nothing in them can break either.
fn validate_filename(name: &str) -> Result<()> {
    let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.');
    if name.is_empty() || name.len() > MAX_NAME || name.starts_with('.') || !name.chars().all(plain) {
        return Err(AppError::new("invalidQuery", "Invalid file name"));
    }
    Ok(())
}

/// What the file is, from its name: only the pictures a comment can show.
fn content_type(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// A multipart boundary that doesn't appear in `data`.
fn boundary_for(data: &[u8]) -> String {
    (0u32..)
        .map(|n| format!("----tracket-{n}"))
        .find(|candidate| {
            let marker = candidate.as_bytes();
            !data.windows(marker.len()).any(|window| window == marker)
        })
        .expect("a free boundary")
}

/// The body of a `multipart/form-data` request with one part, `file`.
fn multipart_body(boundary: &str, filename: &str, content_type: &str, data: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn header(request: &Request<'_>, name: &str) -> Result<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .ok_or_else(|| AppError::new("invalidQuery", format!("Missing {name}")))
}

/// Attaches a picture to the ticket. The bytes are the body of the call; the ticket and the file name are its
/// `key` and `filename` headers.
#[tauri::command]
pub async fn upload_attachment(
    http: tauri::State<'_, reqwest::Client>,
    request: Request<'_>,
) -> Result<()> {
    let key = header(&request, "key")?;
    let filename = header(&request, "filename")?;
    validate_key(&key)?;
    validate_filename(&filename)?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err(AppError::new("invalidQuery", "No file to attach"));
    };
    if data.is_empty() {
        return Err(AppError::new("invalidQuery", "The file is empty"));
    }
    let credentials = load_credentials()?
        .ok_or_else(|| AppError::new("invalidCredentials", "You're not signed in"))?;

    let boundary = boundary_for(data);
    let body = multipart_body(&boundary, &filename, content_type(&filename), data);
    let response = http
        .post(format!(
            "{}/rest/api/2/issue/{key}/attachments",
            credentials.site
        ))
        .basic_auth(&credentials.email, Some(&credentials.token))
        // Jira refuses uploads without it (cross-site request protection)
        .header("X-Atlassian-Token", "no-check")
        .header(CONTENT_TYPE, format!("multipart/form-data; boundary={boundary}"))
        .body(body)
        .send()
        .await
        .map_err(AppError::network)?;
    ensure_ok(response).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{boundary_for, content_type, multipart_body, validate_filename};

    #[test]
    fn accepts_plain_names_only() {
        assert!(validate_filename("image-20261118-153045123.png").is_ok());
        assert!(validate_filename("").is_err());
        assert!(validate_filename(".hidden.png").is_err());
        assert!(validate_filename("a/b.png").is_err());
        assert!(validate_filename("a\"b.png").is_err());
        assert!(validate_filename("a b.png").is_err());
        assert!(validate_filename("a\r\nb.png").is_err());
        assert!(validate_filename(&"a".repeat(101)).is_err());
    }

    #[test]
    fn knows_the_pictures() {
        assert_eq!(content_type("a.png"), "image/png");
        assert_eq!(content_type("a.JPG"), "image/jpeg");
        assert_eq!(content_type("a.webp"), "image/webp");
        assert_eq!(content_type("a.exe"), "application/octet-stream");
        assert_eq!(content_type("png"), "application/octet-stream");
    }

    #[test]
    fn avoids_a_boundary_found_in_the_data() {
        assert_eq!(boundary_for(b"abc"), "----tracket-0");
        assert_eq!(boundary_for(b"xx----tracket-0xx"), "----tracket-1");
    }

    #[test]
    fn wraps_the_file_in_one_part() {
        let body = multipart_body("B", "a.png", "image/png", &[1, 2, 3]);
        let mut expected = b"--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\nContent-Type: image/png\r\n\r\n".to_vec();
        expected.extend_from_slice(&[1, 2, 3]);
        expected.extend_from_slice(b"\r\n--B--\r\n");
        assert_eq!(body, expected);
    }
}
