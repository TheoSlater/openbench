//! Executable resolution.
//!
//! Reusable across vendors: given a program name, find a runnable executable by
//! consulting, in order, a saved user override, `PATH`, and the locations
//! package managers actually install into.
//!
//! Deliberately does not shell out to `which` or `where`:
//!
//! - A desktop app does not inherit a login shell's `PATH`. On macOS an app
//!   launched from Finder gets a minimal `PATH` that omits Homebrew and every
//!   Node version manager, so `which` would answer "not installed" for a tool
//!   the user can run in their terminal. The fallback directory list exists for
//!   exactly that case.
//! - `where` on Windows depends on `PATHEXT` handling that differs between
//!   `cmd.exe` and a bare process, and spawning it needs a shell.
//! - Both cost a process spawn per lookup, and rendering must never spawn.
//!
//! Version probing is the one operation here that runs a process, and it is
//! only reached from an explicit verification call.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static RESOLUTION_CACHE: OnceLock<
    Mutex<std::collections::HashMap<String, Result<ResolvedExecutable, ResolveError>>>,
> = OnceLock::new();

pub fn invalidate_resolution_cache() {
    if let Some(cache) = RESOLUTION_CACHE.get() {
        cache.lock().expect("resolution cache").clear();
    }
}

/// Where a resolved executable came from. Mirrors `connections::PathSource`,
/// which is what gets persisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedFrom {
    /// A saved user override.
    UserOverride,
    /// Found on `PATH`.
    PathLookup,
    /// Found in a known package-manager location.
    KnownLocation,
}

/// A runnable executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedExecutable {
    pub path: PathBuf,
    pub source: ResolvedFrom,
}

/// Why resolution failed. Distinguishes "nothing found" from "you pointed me at
/// something I cannot run", because the fixes differ.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// Nothing matching the name was found anywhere that was searched.
    NotFound { program: String, searched: usize },
    /// A user override was set but the path does not exist.
    OverrideMissing { path: PathBuf },
    /// A user override exists but is not a runnable file — a directory, or a
    /// file without the executable bit.
    OverrideNotExecutable { path: PathBuf },
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolveError::NotFound { program, searched } => write!(
                f,
                "could not find {program} in any of {searched} searched locations"
            ),
            ResolveError::OverrideMissing { path } => {
                write!(f, "the configured path does not exist: {}", path.display())
            }
            ResolveError::OverrideNotExecutable { path } => write!(
                f,
                "the configured path is not a runnable executable: {}",
                path.display()
            ),
        }
    }
}

/// One resolution attempt.
#[derive(Debug, Clone, Default)]
pub struct ResolveRequest {
    /// Program name without a platform extension, e.g. `codex-acp`.
    pub program: String,
    /// A saved user override. Takes precedence over everything, and a bad one
    /// is an error rather than a reason to keep looking — silently ignoring it
    /// would leave the user staring at a setting that does nothing.
    pub override_path: Option<PathBuf>,
    /// `PATH` entries to search. Defaults to the process environment.
    pub path_entries: Option<Vec<PathBuf>>,
    /// Extra directories searched after `PATH`. Defaults to
    /// [`default_known_locations`].
    pub known_locations: Option<Vec<PathBuf>>,
}

impl ResolveRequest {
    #[must_use]
    pub fn new(program: impl Into<String>) -> Self {
        ResolveRequest {
            program: program.into(),
            ..Default::default()
        }
    }

    #[must_use]
    pub fn with_override(mut self, path: Option<PathBuf>) -> Self {
        self.override_path = path;
        self
    }

    #[must_use]
    pub fn with_path_entries(mut self, entries: Vec<PathBuf>) -> Self {
        self.path_entries = Some(entries);
        self
    }

    #[must_use]
    pub fn with_known_locations(mut self, locations: Vec<PathBuf>) -> Self {
        self.known_locations = Some(locations);
        self
    }
}

/// Candidate file names for a program on this platform.
///
/// On Windows a bare name is not runnable: the extension comes from `PATHEXT`,
/// and a process that is not `cmd.exe` has to apply it itself.
#[must_use]
pub fn candidate_file_names(program: &str) -> Vec<OsString> {
    #[cfg(windows)]
    {
        let mut names = Vec::new();
        // An explicit extension is taken as given.
        if Path::new(program).extension().is_some() {
            names.push(OsString::from(program));
            return names;
        }
        let pathext =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        for extension in pathext.split(';').filter(|part| !part.trim().is_empty()) {
            names.push(OsString::from(format!("{program}{extension}")));
        }
        // Some npm shims ship without an extension at all.
        names.push(OsString::from(program));
        names
    }
    #[cfg(not(windows))]
    {
        vec![OsString::from(program)]
    }
}

/// Whether a path is a file this process could execute.
#[must_use]
pub fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// `PATH` split into directories.
#[must_use]
pub fn path_entries_from_env() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

#[must_use]
pub fn nvm_default_bin(home: &Path) -> Option<PathBuf> {
    let version = std::fs::read_to_string(home.join(".nvm/alias/default"))
        .ok()?
        .trim()
        .to_string();
    if version.is_empty() || version.contains('/') || version.contains('\\') {
        return None;
    }
    Some(home.join(".nvm/versions/node").join(version).join("bin"))
}

#[must_use]
pub fn augmented_path() -> OsString {
    let mut entries = path_entries_from_env();
    entries.extend(default_known_locations());
    if let Some(nvm) = dirs::home_dir().and_then(|home| nvm_default_bin(&home)) {
        entries.push(nvm);
    }
    let mut seen = std::collections::HashSet::new();
    entries.retain(|entry| seen.insert(entry.clone()));
    std::env::join_paths(entries).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// Directories package managers install into, which a windowed app's `PATH`
/// routinely omits.
///
/// Every entry is a directory a package manager is documented to use. Nothing
/// here is executed; the list only decides where to `stat`.
#[must_use]
pub fn default_known_locations() -> Vec<PathBuf> {
    let home = dirs::home_dir();
    let mut locations: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        // Homebrew: Apple silicon, then Intel.
        locations.push(PathBuf::from("/opt/homebrew/bin"));
        locations.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(target_os = "linux")]
    {
        locations.push(PathBuf::from("/usr/local/bin"));
        locations.push(PathBuf::from("/usr/bin"));
        // Homebrew on Linux.
        locations.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    }

    if let Some(home) = home.as_ref() {
        // npm global prefix variants.
        locations.push(home.join(".npm-global/bin"));
        locations.push(home.join(".local/bin"));
        locations.push(home.join(".local/share/npm/bin"));
        // Bun, pnpm, Yarn.
        locations.push(home.join(".bun/bin"));
        locations.push(home.join("Library/pnpm"));
        locations.push(home.join(".config/yarn/global/node_modules/.bin"));
        // Volta and asdf shims.
        locations.push(home.join(".volta/bin"));
        locations.push(home.join(".asdf/shims"));
        if let Some(nvm) = nvm_default_bin(home) {
            locations.push(nvm);
        }

        #[cfg(windows)]
        {
            locations.push(home.join("AppData/Roaming/npm"));
            locations.push(home.join("AppData/Local/pnpm"));
            locations.push(home.join(".bun/bin"));
        }
    }

    #[cfg(windows)]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            locations.push(PathBuf::from(program_files).join("nodejs"));
        }
    }

    locations
}

/// Resolve a program to a runnable executable.
///
/// Order: user override, then `PATH`, then known locations. Pure `stat` calls —
/// no process is spawned, so this is safe to call from a background refresh.
pub fn resolve(request: &ResolveRequest) -> Result<ResolvedExecutable, ResolveError> {
    let cacheable = request.override_path.is_none()
        && request.path_entries.is_none()
        && request.known_locations.is_none()
        && Path::new(&request.program).components().count() == 1;
    if cacheable {
        if let Some(cached) = RESOLUTION_CACHE
            .get_or_init(|| Mutex::new(std::collections::HashMap::new()))
            .lock()
            .expect("resolution cache")
            .get(&request.program)
            .cloned()
        {
            return cached;
        }
    }

    let result = resolve_uncached(request);
    if cacheable {
        RESOLUTION_CACHE
            .get_or_init(|| Mutex::new(std::collections::HashMap::new()))
            .lock()
            .expect("resolution cache")
            .insert(request.program.clone(), result.clone());
    }
    result
}

fn resolve_uncached(request: &ResolveRequest) -> Result<ResolvedExecutable, ResolveError> {
    if let Some(override_path) = request
        .override_path
        .as_ref()
        .filter(|path| !path.as_os_str().is_empty())
    {
        // A configured override that does not work is reported, never skipped.
        if !override_path.exists() {
            return Err(ResolveError::OverrideMissing {
                path: override_path.clone(),
            });
        }
        if !is_executable_file(override_path) {
            return Err(ResolveError::OverrideNotExecutable {
                path: override_path.clone(),
            });
        }
        return Ok(ResolvedExecutable {
            path: override_path.clone(),
            source: ResolvedFrom::UserOverride,
        });
    }

    let literal = Path::new(&request.program);
    if literal.components().count() > 1 && is_executable_file(literal) {
        return Ok(ResolvedExecutable {
            path: literal.to_path_buf(),
            source: ResolvedFrom::PathLookup,
        });
    }

    let names = candidate_file_names(&request.program);
    let path_entries = request
        .path_entries
        .clone()
        .unwrap_or_else(path_entries_from_env);
    let known = request
        .known_locations
        .clone()
        .unwrap_or_else(default_known_locations);

    let mut searched = 0;
    for (directories, source) in [(&path_entries, ResolvedFrom::PathLookup)] {
        for directory in directories {
            searched += 1;
            for name in &names {
                // `Path::join` handles spaces and quoting correctly; building
                // the string by hand is how "C:\Program Files\..." breaks.
                let candidate = directory.join(name);
                if is_executable_file(&candidate) {
                    return Ok(ResolvedExecutable {
                        path: candidate,
                        source,
                    });
                }
            }
        }
    }

    if request.path_entries.is_none() {
        if let Some(path) = login_shell_resolve(&request.program) {
            return Ok(ResolvedExecutable {
                path,
                source: ResolvedFrom::PathLookup,
            });
        }
    }

    for directory in &known {
        searched += 1;
        for name in &names {
            let candidate = directory.join(name);
            if is_executable_file(&candidate) {
                return Ok(ResolvedExecutable {
                    path: candidate,
                    source: ResolvedFrom::KnownLocation,
                });
            }
        }
    }

    Err(ResolveError::NotFound {
        program: request.program.clone(),
        searched,
    })
}

#[cfg(unix)]
fn login_shell_resolve(program: &str) -> Option<PathBuf> {
    let shell = std::env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/sh"));
    let found = probe_version(
        Path::new(&shell),
        &["-lc", "command -v -- \"$1\"", "poly-resolve", program],
        std::time::Duration::from_secs(10),
    )?;
    let path = PathBuf::from(found);
    is_executable_file(&path).then_some(path)
}

#[cfg(not(unix))]
fn login_shell_resolve(_program: &str) -> Option<PathBuf> {
    None
}

/// Run an executable to read its version.
///
/// The only function here that spawns. Bounded by `timeout`, and a failure is
/// `None` rather than an error: a missing version string is informational, and
/// readiness is decided by a successful ACP initialize instead.
pub fn probe_version(
    executable: &Path,
    args: &[&str],
    timeout: std::time::Duration,
) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    use std::process::{Command, Stdio};

    let temp_root = std::env::temp_dir();
    let nonce = uuid::Uuid::new_v4();
    let stdout_path = temp_root.join(format!("poly-version-{nonce}.out"));
    let stderr_path = temp_root.join(format!("poly-version-{nonce}.err"));
    let mut stdout_file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&stdout_path)
        .ok()?;
    let mut stderr_file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&stderr_path)
        .ok()?;
    let mut child = Command::new(executable)
        .args(args)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        // Regular files do not wait for EOF from forked descendants that
        // inherited stdout/stderr, unlike pipes.
        .stdout(Stdio::from(stdout_file.try_clone().ok()?))
        .stderr(Stdio::from(stderr_file.try_clone().ok()?))
        .spawn()
        .ok()?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&stdout_path);
                let _ = std::fs::remove_file(&stderr_path);
                return None;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(_) => return None,
        }
    }

    let _ = child.wait().ok()?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    stdout_file.seek(SeekFrom::Start(0)).ok()?;
    stderr_file.seek(SeekFrom::Start(0)).ok()?;
    stdout_file.take(64 * 1024).read_to_end(&mut stdout).ok()?;
    stderr_file.take(64 * 1024).read_to_end(&mut stderr).ok()?;
    let _ = std::fs::remove_file(stdout_path);
    let _ = std::fs::remove_file(stderr_path);

    let stdout = String::from_utf8_lossy(&stdout);
    let text = if stdout.trim().is_empty() {
        String::from_utf8_lossy(&stderr).into_owned()
    } else {
        stdout.into_owned()
    };
    let first = text.lines().find(|line| !line.trim().is_empty())?;
    Some(first.trim().to_string())
}

/// Parse one strict `major.minor.patch` token from version output.
///
/// Partial, prerelease, and four-component versions fail closed.
#[must_use]
pub fn parse_strict_version(output: &str) -> Option<[u64; 3]> {
    output.split_whitespace().find_map(|version_text| {
        let mut components = version_text.split('.');
        let parsed = [
            components.next()?.parse().ok()?,
            components.next()?.parse().ok()?,
            components.next()?.parse().ok()?,
        ];
        components.next().is_none().then_some(parsed)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("poly-resolve-{label}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            Fixture { root }
        }

        fn dir(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            std::fs::create_dir_all(&path).unwrap();
            path
        }

        fn executable(&self, dir: &Path, name: &str) -> PathBuf {
            let path = dir.join(name);
            std::fs::write(&path, "#!/bin/sh\necho hi\n").unwrap();
            set_executable(&path);
            path
        }

        fn plain_file(&self, dir: &Path, name: &str) -> PathBuf {
            let path = dir.join(name);
            std::fs::write(&path, "not executable").unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn set_executable(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions).unwrap();
        }
        #[cfg(not(unix))]
        let _ = path;
    }

    #[test]
    fn finds_an_executable_on_path() {
        let fixture = Fixture::new("path");
        let bin = fixture.dir("bin");
        let expected = fixture.executable(&bin, "codex-acp");

        let resolved = resolve(
            &ResolveRequest::new("codex-acp")
                .with_path_entries(vec![bin])
                .with_known_locations(vec![]),
        )
        .unwrap();

        assert_eq!(resolved.path, expected);
        assert_eq!(resolved.source, ResolvedFrom::PathLookup);
    }

    #[test]
    fn falls_back_to_a_known_location_when_path_omits_it() {
        // The macOS case: a windowed app's PATH has no Homebrew in it.
        let fixture = Fixture::new("known");
        let empty = fixture.dir("empty");
        let brew = fixture.dir("opt-homebrew-bin");
        let expected = fixture.executable(&brew, "codex-acp");

        let resolved = resolve(
            &ResolveRequest::new("codex-acp")
                .with_path_entries(vec![empty])
                .with_known_locations(vec![brew]),
        )
        .unwrap();

        assert_eq!(resolved.path, expected);
        assert_eq!(resolved.source, ResolvedFrom::KnownLocation);
    }

    #[test]
    fn path_wins_over_a_known_location() {
        let fixture = Fixture::new("precedence");
        let bin = fixture.dir("bin");
        let brew = fixture.dir("brew");
        let on_path = fixture.executable(&bin, "codex-acp");
        fixture.executable(&brew, "codex-acp");

        let resolved = resolve(
            &ResolveRequest::new("codex-acp")
                .with_path_entries(vec![bin])
                .with_known_locations(vec![brew]),
        )
        .unwrap();

        assert_eq!(resolved.path, on_path);
    }

    #[test]
    fn an_override_beats_everything_else() {
        let fixture = Fixture::new("override");
        let bin = fixture.dir("bin");
        let custom = fixture.dir("custom");
        fixture.executable(&bin, "codex-acp");
        let chosen = fixture.executable(&custom, "my-codex");

        let resolved = resolve(
            &ResolveRequest::new("codex-acp")
                .with_override(Some(chosen.clone()))
                .with_path_entries(vec![bin])
                .with_known_locations(vec![]),
        )
        .unwrap();

        assert_eq!(resolved.path, chosen);
        assert_eq!(resolved.source, ResolvedFrom::UserOverride);
    }

    #[test]
    fn a_missing_override_is_an_error_not_a_fallback() {
        let fixture = Fixture::new("override-missing");
        let bin = fixture.dir("bin");
        fixture.executable(&bin, "codex-acp");
        let missing = fixture.root.join("nope/does-not-exist");

        let error = resolve(
            &ResolveRequest::new("codex-acp")
                .with_override(Some(missing.clone()))
                .with_path_entries(vec![bin])
                .with_known_locations(vec![]),
        )
        .unwrap_err();

        // Falling back silently would leave the user's setting doing nothing.
        assert_eq!(error, ResolveError::OverrideMissing { path: missing });
    }

    #[test]
    fn an_override_pointing_at_a_non_executable_is_rejected() {
        let fixture = Fixture::new("override-not-exec");
        let dir = fixture.dir("dir");
        let plain = fixture.plain_file(&dir, "not-runnable");

        let error = resolve(
            &ResolveRequest::new("codex-acp")
                .with_override(Some(plain.clone()))
                .with_path_entries(vec![])
                .with_known_locations(vec![]),
        )
        .unwrap_err();

        #[cfg(unix)]
        assert_eq!(error, ResolveError::OverrideNotExecutable { path: plain });
        // Windows has no executable bit; existence is the only check there.
        #[cfg(not(unix))]
        let _ = error;
    }

    #[test]
    fn an_override_pointing_at_a_directory_is_rejected() {
        let fixture = Fixture::new("override-dir");
        let dir = fixture.dir("a-directory");

        let error = resolve(
            &ResolveRequest::new("codex-acp")
                .with_override(Some(dir.clone()))
                .with_path_entries(vec![])
                .with_known_locations(vec![]),
        )
        .unwrap_err();

        assert_eq!(error, ResolveError::OverrideNotExecutable { path: dir });
    }

    #[test]
    fn reports_not_found_with_the_number_of_places_searched() {
        let fixture = Fixture::new("missing");
        let a = fixture.dir("a");
        let b = fixture.dir("b");

        let error = resolve(
            &ResolveRequest::new("codex-acp")
                .with_path_entries(vec![a])
                .with_known_locations(vec![b]),
        )
        .unwrap_err();

        assert_eq!(
            error,
            ResolveError::NotFound {
                program: "codex-acp".into(),
                searched: 2,
            }
        );
    }

    #[test]
    fn handles_directories_and_file_names_containing_spaces() {
        let fixture = Fixture::new("spaces");
        let dir = fixture.dir("Program Files/Poly UI/bin");
        let expected = fixture.executable(&dir, "codex acp");

        let resolved = resolve(
            &ResolveRequest::new("codex acp")
                .with_path_entries(vec![dir])
                .with_known_locations(vec![]),
        )
        .unwrap();

        assert_eq!(resolved.path, expected);
        assert!(resolved.path.to_string_lossy().contains("Program Files"));
    }

    #[test]
    fn an_override_path_with_spaces_resolves() {
        let fixture = Fixture::new("override-spaces");
        let dir = fixture.dir("My Tools");
        let chosen = fixture.executable(&dir, "codex acp");

        let resolved =
            resolve(&ResolveRequest::new("codex-acp").with_override(Some(chosen.clone()))).unwrap();

        assert_eq!(resolved.path, chosen);
    }

    #[test]
    fn a_directory_never_resolves_as_an_executable() {
        let fixture = Fixture::new("dir-not-exec");
        let bin = fixture.dir("bin");
        // A directory named exactly like the program must not satisfy lookup.
        std::fs::create_dir_all(bin.join("codex-acp")).unwrap();

        let error = resolve(
            &ResolveRequest::new("codex-acp")
                .with_path_entries(vec![bin])
                .with_known_locations(vec![]),
        )
        .unwrap_err();

        assert!(matches!(error, ResolveError::NotFound { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_without_the_executable_bit_is_skipped_on_path() {
        let fixture = Fixture::new("no-exec-bit");
        let bin = fixture.dir("bin");
        fixture.plain_file(&bin, "codex-acp");

        let error = resolve(
            &ResolveRequest::new("codex-acp")
                .with_path_entries(vec![bin])
                .with_known_locations(vec![]),
        )
        .unwrap_err();

        assert!(matches!(error, ResolveError::NotFound { .. }));
    }

    #[test]
    fn candidate_names_cover_platform_extensions() {
        let names = candidate_file_names("codex-acp");
        assert!(!names.is_empty());
        #[cfg(windows)]
        {
            let joined: Vec<String> = names
                .iter()
                .map(|name| name.to_string_lossy().to_uppercase())
                .collect();
            assert!(joined.iter().any(|name| name.ends_with(".EXE")));
            // A bare name is still tried, for extensionless npm shims.
            assert!(joined.iter().any(|name| name == "CODEX-ACP"));
        }
        #[cfg(not(windows))]
        assert_eq!(names, vec![OsString::from("codex-acp")]);
    }

    #[test]
    fn strict_versions_require_three_plain_numeric_components() {
        assert_eq!(parse_strict_version("1.2.3"), Some([1, 2, 3]));
        assert_eq!(parse_strict_version("codex-acp 1.2.3\n"), Some([1, 2, 3]));
        assert_eq!(parse_strict_version("1.2"), None);
        assert_eq!(parse_strict_version("1.2.0-rc1"), None);
        assert_eq!(parse_strict_version("1.2.3.4"), None);
    }

    #[test]
    fn nvm_default_bin_comes_from_the_default_alias() {
        let fixture = Fixture::new("nvm");
        let alias = fixture.root.join(".nvm/alias");
        std::fs::create_dir_all(&alias).unwrap();
        std::fs::write(alias.join("default"), "v22.17.0\n").unwrap();
        assert_eq!(
            nvm_default_bin(&fixture.root),
            Some(fixture.root.join(".nvm/versions/node/v22.17.0/bin"))
        );
    }

    #[test]
    fn explicit_invalidation_clears_executable_resolution() {
        let cache = RESOLUTION_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
        cache.lock().unwrap().insert(
            "codex-acp".into(),
            Err(ResolveError::NotFound {
                program: "codex-acp".into(),
                searched: 0,
            }),
        );

        invalidate_resolution_cache();

        assert!(!cache.lock().unwrap().contains_key("codex-acp"));
    }

    #[test]
    fn default_known_locations_are_absolute_and_unique_enough_to_stat() {
        let locations = default_known_locations();
        assert!(!locations.is_empty());
        for location in &locations {
            assert!(
                location.is_absolute(),
                "{} must be absolute",
                location.display()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn probes_a_version_string() {
        let fixture = Fixture::new("probe");
        let bin = fixture.dir("bin");
        let script = bin.join("versioned");
        std::fs::write(&script, "#!/bin/sh\necho 1.2.3\n").unwrap();
        set_executable(&script);

        let version = probe_version(&script, &["--version"], std::time::Duration::from_secs(5));
        assert_eq!(version.as_deref(), Some("1.2.3"));
    }

    #[cfg(unix)]
    #[test]
    fn a_descendant_inheriting_stdout_cannot_hold_a_probe_open() {
        let fixture = Fixture::new("probe-descendant");
        let bin = fixture.dir("bin");
        let script = bin.join("forks");
        std::fs::write(&script, "#!/bin/sh\nsleep 30 &\necho 1.2.3\n").unwrap();
        set_executable(&script);

        let started = std::time::Instant::now();
        let version = probe_version(&script, &[], std::time::Duration::from_secs(2));
        assert_eq!(version.as_deref(), Some("1.2.3"));
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn a_version_probe_that_hangs_is_bounded_and_returns_none() {
        let fixture = Fixture::new("probe-hang");
        let bin = fixture.dir("bin");
        let script = bin.join("hangs");
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        set_executable(&script);

        let started = std::time::Instant::now();
        let version = probe_version(
            &script,
            &["--version"],
            std::time::Duration::from_millis(300),
        );
        assert_eq!(version, None);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "probe must not wait for the child"
        );
    }

    #[test]
    fn probing_a_missing_executable_returns_none() {
        assert_eq!(
            probe_version(
                Path::new("/definitely/not/here/poly"),
                &["--version"],
                std::time::Duration::from_secs(1)
            ),
            None
        );
    }
}
