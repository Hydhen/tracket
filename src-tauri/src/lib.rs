mod auth;
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
            transition::get_transitions,
            transition::transition_issue,
            fields::get_ticket_fields,
            fields::get_field_values,
            metadata::get_edit_meta,
            metadata::update_issue_fields,
            metadata::search_assignable_users,
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
