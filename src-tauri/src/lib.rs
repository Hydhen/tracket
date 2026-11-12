mod auth;
mod comment;
mod detail;
mod edit;
mod error;
mod fields;
mod jira;
mod media;
mod metadata;
mod storage;
mod transition;
mod worklog;
mod workspace;

/// How long the hidden window waits for its page before showing anyway.
const SHOW_WINDOW_AFTER: std::time::Duration = std::time::Duration::from_secs(3);

/// The window starts hidden (see tauri.conf.json) and is shown once its page has loaded, so the first
/// thing on screen is the loader in index.html rather than an empty white window. Its background is
/// the app's, for the system theme, in case the first frames come before the page paints.
/// If the page never reports being loaded, the window shows after `SHOW_WINDOW_AFTER` all the same.
fn show_window_when_ready(app: &tauri::App) {
    use tauri::{Manager, Theme, window::Color};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let late = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_WINDOW_AFTER);
        let _ = late.show();
    });
    let background = match window.theme() {
        Ok(Theme::Dark) => Color(25, 25, 25, 255),
        _ => Color(255, 255, 255, 255),
    };
    // A cosmetic touch: the app works the same without it
    let _ = window.set_background_color(Some(background));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Updates come from this repository's GitHub releases, signed with the key in tauri.conf.json
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(auth::build_http_client())
        .manage(storage::Storage::default())
        .register_asynchronous_uri_scheme_protocol("jira", media::handle)
        .invoke_handler(tauri::generate_handler![
            auth::login,
            auth::current_session,
            auth::logout,
            jira::search_issues,
            detail::get_issue,
            edit::get_description_source,
            edit::update_description,
            comment::add_comment,
            comment::get_comment_source,
            comment::update_comment,
            transition::get_transitions,
            transition::transition_issue,
            fields::get_ticket_fields,
            fields::get_field_values,
            metadata::get_edit_meta,
            metadata::update_issue_fields,
            metadata::search_assignable_users,
            metadata::search_mentionable_users,
            worklog::add_worklog,
            workspace::check_repo,
            workspace::create_worktree,
            workspace::open_in_vscode,
            workspace::open_in_herdr,
            storage::storage_load,
            storage::storage_set,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            show_window_when_ready(app);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
