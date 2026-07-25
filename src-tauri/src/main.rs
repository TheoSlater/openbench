// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // CEF re-executes this binary for its own child processes (render, GPU,
    // zygote, utility), telling them apart by `--type=` on the command line.
    // This must stay the first statement in main: CEF forks a zygote on Linux,
    // and forking a process that already has threads is undefined behaviour.
    // See cef_osr's module docs.
    #[cfg(cef)]
    if polyui_lib::cef_osr::enabled_on_next_start() {
        if let Some(code) = polyui_lib::cef_osr::execute_subprocess() {
            std::process::exit(code);
        }
    }

    polyui_lib::run()
}
