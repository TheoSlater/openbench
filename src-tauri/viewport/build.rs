fn main() {
    println!("cargo::rerun-if-env-changed=CEF_PATH");
    let target = std::env::var("TARGET").expect("TARGET missing");

    // cef-dll-sys copies libcef.so next to the binary but never tells the
    // linker to look there, so the binary dies at startup with
    // "libcef.so: cannot open shared object file". $ORIGIN resolves to the
    // binary's own directory at load time, which is where the downloaded CEF
    // pack puts both this helper and the runtime.
    //
    // Unlike the old in-process build there is no ../lib/PolyUI entry: nothing
    // installs CEF into the system prefix any more. There is also no SQLite
    // version script — that existed because polyui's bundled sqlx SQLite
    // interposed over the system one that CEF's NSS drives, and this binary
    // links no sqlx at all.
    if target.contains("linux") {
        println!("cargo::rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    }
}
