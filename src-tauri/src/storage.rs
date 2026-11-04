//! The UI's remembered state (settings, timers…) in one JSON file, `state.json` in the user's roaming app data.
//!
//! The folder name is fixed rather than derived from the app's identifier: the dev build has its own identifier
//! (so it gets its own webview profile and can run next to the installed app) but must see the same settings.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, Result};

const FOLDER: &str = "com.tracket.app";
const FILE: &str = "state.json";

type Entries = BTreeMap<String, String>;

/// Serializes the read-modify-write cycles of this process.
#[derive(Default)]
pub struct Storage(Mutex<()>);

fn storage_error(e: impl std::fmt::Display) -> AppError {
    AppError::new("storage", e.to_string())
}

fn file_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .data_dir()
        .map_err(storage_error)?
        .join(FOLDER);
    fs::create_dir_all(&dir).map_err(storage_error)?;
    Ok(dir.join(FILE))
}

/// A missing file is an empty state. An unreadable one is set aside, never overwritten, so a bad write can't
/// silently destroy the settings.
fn read(path: &Path) -> Entries {
    let Ok(text) = fs::read_to_string(path) else {
        return Entries::new();
    };
    serde_json::from_str(&text).unwrap_or_else(|_| {
        let _ = fs::rename(path, path.with_extension("json.bad"));
        Entries::new()
    })
}

fn write(path: &Path, entries: &Entries) -> Result<()> {
    let text = serde_json::to_string_pretty(entries).map_err(storage_error)?;
    // Written next to the target then moved over it, so a crash never leaves half a file
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&temp, text).map_err(storage_error)?;
    fs::rename(&temp, path).map_err(storage_error)
}

fn update(path: &Path, key: String, value: Option<String>) -> Result<()> {
    let mut entries = read(path);
    match value {
        Some(value) => entries.insert(key, value),
        None => entries.remove(&key),
    };
    write(path, &entries)
}

#[tauri::command]
pub fn storage_load(app: AppHandle, storage: State<'_, Storage>) -> Result<Entries> {
    let _guard = storage.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(read(&file_path(&app)?))
}

/// Stores `value` under `key`, or forgets the key when `value` is `None`.
#[tauri::command]
pub fn storage_set(
    app: AppHandle,
    storage: State<'_, Storage>,
    key: String,
    value: Option<String>,
) -> Result<()> {
    let _guard = storage.0.lock().unwrap_or_else(|e| e.into_inner());
    update(&file_path(&app)?, key, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tracket-storage-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join(FILE)
    }

    #[test]
    fn missing_file_is_empty() {
        assert!(read(&temp_file("missing")).is_empty());
    }

    #[test]
    fn set_keeps_the_other_keys_and_remove_forgets() {
        let path = temp_file("set");
        update(&path, "a".into(), Some("1".into())).unwrap();
        update(&path, "b".into(), Some("2".into())).unwrap();
        update(&path, "a".into(), Some("3".into())).unwrap();
        let entries = read(&path);
        assert_eq!(entries.get("a").map(String::as_str), Some("3"));
        assert_eq!(entries.get("b").map(String::as_str), Some("2"));

        update(&path, "a".into(), None).unwrap();
        assert!(!read(&path).contains_key("a"));
        assert!(read(&path).contains_key("b"));
    }

    #[test]
    fn unreadable_file_is_set_aside() {
        let path = temp_file("bad");
        fs::write(&path, "{ not json").unwrap();
        assert!(read(&path).is_empty());
        assert!(!path.exists());
        assert!(path.with_extension("json.bad").exists());
    }
}
