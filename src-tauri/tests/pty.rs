use polyui_lib::pty::validate_pty_size;

#[test]
fn validates_pty_dimensions() {
    assert!(validate_pty_size(80, 24).is_ok());
    assert!(validate_pty_size(0, 24).is_err());
    assert!(validate_pty_size(80, 0).is_err());
}

#[test]
fn ai_command_path_has_no_host_shell_fallback() {
    let source = include_str!("../src/pty.rs");
    let ai_path = source
        .split("pub async fn pty_spawn_command")
        .nth(1)
        .and_then(|tail| tail.split("fn forward_pty_event").next())
        .unwrap();
    assert!(!ai_path.contains("new_default_prog"));
    assert!(!ai_path.contains("dirs::home_dir"));
    assert!(ai_path.contains("sandboxes.spawn_command"));
    assert!(ai_path.contains("sandbox_command.headless"));
    assert!(ai_path.contains("builder.env_clear()"));
    assert!(source.contains("#[tauri::command(async)]\npub async fn pty_spawn_command"));
    assert!(ai_path.contains("spawn_blocking"));
    assert!(source.contains("kind: \"status\""));
}
