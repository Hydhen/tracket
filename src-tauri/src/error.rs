use serde::Serialize;

/// Error sent to the UI as `{ kind, message }`.
#[derive(Serialize, Debug)]
pub struct AppError {
    pub kind: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn network(e: reqwest::Error) -> Self {
        if e.is_timeout() || e.is_connect() {
            Self::new(
                "network",
                "Couldn't reach Jira. Check the site address and your connection.",
            )
        } else {
            Self::new("network", e.to_string())
        }
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
