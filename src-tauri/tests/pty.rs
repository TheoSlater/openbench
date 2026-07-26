use polyui_lib::pty::validate_pty_size;

#[test]
fn validates_pty_dimensions() {
    assert!(validate_pty_size(80, 24).is_ok());
    assert!(validate_pty_size(0, 24).is_err());
    assert!(validate_pty_size(80, 0).is_err());
}
