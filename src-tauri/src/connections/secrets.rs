//! Credential storage and redaction.
//!
//! The database never holds credential material. It holds a [`SecretRef`], an
//! opaque handle naming an entry in the OS keychain (Keychain on macOS,
//! Credential Manager on Windows, Secret Service on Linux).
//!
//! [`Secret`] deliberately implements neither `Serialize` nor a revealing
//! `Debug`. A secret cannot reach a log line, an event payload, or an export
//! by accident — it has to be pulled out with [`Secret::expose`], which is
//! greppable.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

/// Placeholder substituted for any redacted value.
pub const REDACTED: &str = "***";

const KEYRING_SERVICE: &str = "dev.polyui.credentials";

/// An opaque handle to a credential in the OS keychain.
///
/// Safe to store, log, and send to the frontend: it names a credential without
/// being one.
/// Serializes as a bare string. ts-rs cannot read `serde(transparent)`, so this
/// type is not exported on its own — the fields that hold one carry
/// `#[ts(type = "string")]` instead, which is what serde actually emits.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretRef(pub String);

impl SecretRef {
    /// The handle for a connection's credential.
    #[must_use]
    pub fn for_connection(connection_id: &str) -> Self {
        SecretRef(format!("connection/{connection_id}"))
    }

    /// The handle for a web-search provider's API key.
    #[must_use]
    pub fn for_web_search(provider: &str) -> Self {
        SecretRef(format!("web-search/{provider}"))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SecretRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A credential value.
///
/// Intentionally not `Serialize`. Its `Debug` prints the placeholder, so a
/// `{:?}` on a struct containing one cannot leak it.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Secret(value.into())
    }

    /// Read the credential. Call sites are the audit surface — keep them few.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Secret({REDACTED})")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// Why a credential operation failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    /// No credential stored under this handle.
    NotFound,
    /// The platform keychain is unavailable — commonly a headless Linux box
    /// with no Secret Service running. Callers degrade, they do not fall back
    /// to plaintext.
    Unavailable(String),
}

impl fmt::Display for SecretError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecretError::NotFound => f.write_str("no credential stored"),
            SecretError::Unavailable(detail) => {
                write!(f, "credential store unavailable: {detail}")
            }
        }
    }
}

/// Credential storage. Injectable so tests never touch a real keychain.
pub trait SecretStore: Send + Sync {
    fn get(&self, reference: &SecretRef) -> Result<Secret, SecretError>;
    fn set(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError>;
    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError>;
}

/// The OS keychain.
#[derive(Debug, Default)]
pub struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry(reference: &SecretRef) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(KEYRING_SERVICE, reference.as_str())
            .map_err(|error| SecretError::Unavailable(error.to_string()))
    }
}

impl SecretStore for KeyringSecretStore {
    fn get(&self, reference: &SecretRef) -> Result<Secret, SecretError> {
        match Self::entry(reference)?.get_password() {
            Ok(value) => Ok(Secret::new(value)),
            Err(keyring::Error::NoEntry) => Err(SecretError::NotFound),
            Err(error) => Err(SecretError::Unavailable(error.to_string())),
        }
    }

    fn set(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
        Self::entry(reference)?
            .set_password(secret.expose())
            .map_err(|error| SecretError::Unavailable(error.to_string()))
    }

    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(SecretError::Unavailable(error.to_string())),
        }
    }
}

/// In-memory store for tests and for the fixture migrations.
#[derive(Debug, Default)]
pub struct InMemorySecretStore {
    entries: std::sync::Mutex<BTreeMap<String, String>>,
    /// When set, every operation reports the store as unavailable — used to
    /// exercise the headless-Linux degradation path.
    unavailable: bool,
}

impl InMemorySecretStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn unavailable() -> Self {
        InMemorySecretStore {
            entries: std::sync::Mutex::new(BTreeMap::new()),
            unavailable: true,
        }
    }

    /// Number of stored credentials. Test helper.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.lock().expect("secret store lock").len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn guard(&self) -> Result<(), SecretError> {
        if self.unavailable {
            return Err(SecretError::Unavailable("test store disabled".into()));
        }
        Ok(())
    }
}

impl SecretStore for InMemorySecretStore {
    fn get(&self, reference: &SecretRef) -> Result<Secret, SecretError> {
        self.guard()?;
        self.entries
            .lock()
            .expect("secret store lock")
            .get(reference.as_str())
            .map(Secret::new)
            .ok_or(SecretError::NotFound)
    }

    fn set(&self, reference: &SecretRef, secret: &Secret) -> Result<(), SecretError> {
        self.guard()?;
        self.entries
            .lock()
            .expect("secret store lock")
            .insert(reference.0.clone(), secret.expose().to_string());
        Ok(())
    }

    fn delete(&self, reference: &SecretRef) -> Result<(), SecretError> {
        self.guard()?;
        self.entries
            .lock()
            .expect("secret store lock")
            .remove(reference.as_str());
        Ok(())
    }
}

/// Replace every value in a JSON header object with [`REDACTED`], keeping the
/// names.
///
/// Header values are the one place user-pasted credentials can still sit in a
/// database column (inherited from the pre-rework `provider_configs.headers`),
/// so anything that formats a connection must run them through this. Names are
/// kept because a diagnostic that says "you set `Authorization`" is useful and
/// a diagnostic that says "you set something" is not.
///
/// Input that is not a JSON object is replaced wholesale rather than passed
/// through — an unparseable blob is exactly where a bare token would hide.
#[must_use]
pub fn redact_headers(raw: &str) -> String {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(raw) else {
        return format!("\"{REDACTED}\"");
    };
    let redacted: serde_json::Map<String, serde_json::Value> = map
        .into_iter()
        .map(|(name, _)| (name, serde_json::Value::String(REDACTED.to_string())))
        .collect();
    serde_json::Value::Object(redacted).to_string()
}

/// Redact a bare credential for a log line, keeping enough to recognise which
/// one it was.
#[must_use]
pub fn redact_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // Fewer than 8 characters cannot spare a prefix without giving up most of
    // the secret.
    if trimmed.chars().count() < 8 {
        return REDACTED.to_string();
    }
    let prefix: String = trimmed.chars().take(4).collect();
    format!("{prefix}…{REDACTED}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_debug_and_display_never_reveal() {
        let secret = Secret::new("sk-live-super-secret-value");
        assert_eq!(format!("{secret:?}"), "Secret(***)");
        assert_eq!(format!("{secret}"), "***");
        assert!(!format!("{secret:?}{secret}").contains("sk-live"));
        assert_eq!(secret.expose(), "sk-live-super-secret-value");
    }

    #[test]
    fn redacts_header_values_but_keeps_names() {
        let redacted = redact_headers(r#"{"Authorization":"Bearer sk-live-abc","X-Trace":"7"}"#);
        assert!(redacted.contains("Authorization"));
        assert!(redacted.contains("X-Trace"));
        assert!(!redacted.contains("sk-live-abc"));
        assert!(!redacted.contains("Bearer"));
        assert!(!redacted.contains('7'));
    }

    #[test]
    fn redacts_unparseable_headers_wholesale() {
        assert_eq!(redact_headers("Bearer sk-live-abc"), "\"***\"");
        assert_eq!(redact_headers("[\"sk-live-abc\"]"), "\"***\"");
        assert!(!redact_headers("sk-live-abc").contains("sk-live"));
    }

    #[test]
    fn redact_value_keeps_a_recognisable_prefix_only() {
        assert_eq!(redact_value("sk-live-abcdefgh"), "sk-l…***");
        assert_eq!(redact_value("short"), "***");
        assert_eq!(redact_value("   "), "");
        assert!(!redact_value("sk-live-abcdefgh").contains("abcdefgh"));
    }

    #[test]
    fn in_memory_store_round_trips() {
        let store = InMemorySecretStore::new();
        let reference = SecretRef::for_connection("conn-1");

        assert_eq!(store.get(&reference), Err(SecretError::NotFound));

        store.set(&reference, &Secret::new("value")).unwrap();
        assert_eq!(store.get(&reference).unwrap().expose(), "value");
        assert_eq!(store.len(), 1);

        store.delete(&reference).unwrap();
        assert_eq!(store.get(&reference), Err(SecretError::NotFound));
        assert!(store.is_empty());
    }

    #[test]
    fn unavailable_store_reports_rather_than_succeeding() {
        let store = InMemorySecretStore::unavailable();
        let reference = SecretRef::for_connection("conn-1");
        assert!(matches!(
            store.set(&reference, &Secret::new("value")),
            Err(SecretError::Unavailable(_))
        ));
        assert!(matches!(
            store.get(&reference),
            Err(SecretError::Unavailable(_))
        ));
    }

    #[test]
    fn secret_refs_are_namespaced() {
        assert_eq!(SecretRef::for_connection("a").as_str(), "connection/a");
        assert_eq!(SecretRef::for_web_search("exa").as_str(), "web-search/exa");
    }
}
