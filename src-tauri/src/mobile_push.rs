use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_APNS_TOPIC: &str = "com.theoslater.polyuiios";
const PROVIDER_TOKEN_TTL: Duration = Duration::from_secs(50 * 60);

struct ApnsCredentials {
    team_id: String,
    key_id: String,
    private_key: String,
    topic: String,
}

struct CachedProviderToken {
    credentials_id: String,
    created_at: Instant,
    value: String,
}

#[derive(Serialize)]
struct ProviderClaims<'a> {
    iss: &'a str,
    iat: u64,
}

#[derive(Serialize)]
struct Alert<'a> {
    title: &'a str,
    body: &'a str,
}

#[derive(Serialize)]
struct Aps<'a> {
    alert: Alert<'a>,
    sound: &'a str,
    category: &'a str,
    #[serde(rename = "thread-id")]
    thread_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletionPayload<'a> {
    aps: Aps<'a>,
    conversation_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalPayload<'a> {
    aps: Aps<'a>,
    kind: &'a str,
    conversation_id: &'a str,
    request_id: &'a str,
    approval_id: &'a str,
    action: &'a str,
    command: Option<&'a str>,
    paths: &'a [String],
    cwd: Option<&'a str>,
}

pub fn validate_registration(token: &str, environment: &str) -> Result<(), String> {
    if token.len() < 32 || token.len() > 512 || token.len() % 2 != 0 {
        return Err("Invalid APNs device token length.".to_string());
    }
    if !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("APNs device token must be hexadecimal.".to_string());
    }
    if !matches!(environment, "sandbox" | "production") {
        return Err("APNs environment must be sandbox or production.".to_string());
    }
    Ok(())
}

pub async fn register_token(db: &SqlitePool, token: &str, environment: &str) -> Result<(), String> {
    validate_registration(token, environment)?;
    sqlx::query(
        "INSERT INTO mobile_push_tokens (token, environment, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP) ON CONFLICT(token) DO UPDATE SET environment = excluded.environment, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(token)
    .bind(environment)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn unregister_token(db: &SqlitePool, token: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM mobile_push_tokens WHERE token = ?1")
        .bind(token)
        .execute(db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn notify_agent_completed(db: &SqlitePool, conversation_id: &str) -> Result<(), String> {
    let payload = CompletionPayload {
        aps: Aps {
            alert: Alert {
                title: "Poly",
                body: "Your agent finished its response.",
            },
            sound: "default",
            category: "agent_completed",
            thread_id: conversation_id,
        },
        conversation_id,
    };
    send_payload(db, &payload).await
}

pub async fn notify_approval_requested(
    db: &SqlitePool,
    conversation_id: &str,
    request_id: &str,
    approval_id: &str,
    action: &str,
    command: Option<&str>,
    paths: &[String],
    cwd: Option<&str>,
) -> Result<(), String> {
    let action = truncate_push_value(action, 120);
    let command = command.map(|value| truncate_push_value(value, 300));
    let paths = paths
        .iter()
        .take(4)
        .map(|path| truncate_push_value(path, 160))
        .collect::<Vec<_>>();
    let cwd = cwd.map(|value| truncate_push_value(value, 160));
    let payload = ApprovalPayload {
        aps: Aps {
            alert: Alert {
                title: "Poly needs approval",
                body: &action,
            },
            sound: "default",
            category: "approval_requested",
            thread_id: conversation_id,
        },
        kind: "approval-requested",
        conversation_id,
        request_id,
        approval_id,
        action: &action,
        command: command.as_deref(),
        paths: &paths,
        cwd: cwd.as_deref(),
    };
    send_payload(db, &payload).await
}

fn truncate_push_value(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

async fn send_payload<T: Serialize + ?Sized>(db: &SqlitePool, payload: &T) -> Result<(), String> {
    let rows = sqlx::query("SELECT token, environment FROM mobile_push_tokens")
        .fetch_all(db)
        .await
        .map_err(|error| error.to_string())?;
    if rows.is_empty() {
        return Ok(());
    }

    let credentials = load_credentials()?;
    let provider_token = provider_token(&credentials)?;
    let client = reqwest::Client::builder()
        .http2_adaptive_window(true)
        .build()
        .map_err(|error| error.to_string())?;
    let mut failures = Vec::new();
    for row in rows {
        let token = row.get::<String, _>("token");
        let environment = row.get::<String, _>("environment");
        let host = if environment == "production" {
            "api.push.apple.com"
        } else {
            "api.sandbox.push.apple.com"
        };
        let response = client
            .post(format!("https://{host}/3/device/{token}"))
            .bearer_auth(&provider_token)
            .header("apns-topic", &credentials.topic)
            .header("apns-push-type", "alert")
            .header("apns-priority", "10")
            .json(payload)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_success() {
            continue;
        }
        let status = response.status();
        let reason = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::GONE {
            let _ = unregister_token(db, &token).await;
        }
        failures.push(format!("APNs {status}: {reason}"));
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn load_credentials() -> Result<ApnsCredentials, String> {
    let team_id = required_env("POLY_APNS_TEAM_ID")?;
    let key_id = required_env("POLY_APNS_KEY_ID")?;
    let private_key_path = PathBuf::from(required_env("POLY_APNS_PRIVATE_KEY_PATH")?);
    let private_key = std::fs::read_to_string(&private_key_path).map_err(|error| {
        format!(
            "Failed to read APNs private key {}: {error}",
            private_key_path.display()
        )
    })?;
    let topic = std::env::var("POLY_APNS_TOPIC").unwrap_or_else(|_| DEFAULT_APNS_TOPIC.to_string());
    Ok(ApnsCredentials {
        team_id,
        key_id,
        private_key,
        topic,
    })
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not configured."))
}

fn provider_token(credentials: &ApnsCredentials) -> Result<String, String> {
    static CACHE: OnceLock<Mutex<Option<CachedProviderToken>>> = OnceLock::new();
    let credentials_id = format!("{}:{}", credentials.team_id, credentials.key_id);
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut cached = cache.lock().map_err(|error| error.to_string())?;
    if let Some(value) = cached.as_ref().filter(|value| {
        value.credentials_id == credentials_id && value.created_at.elapsed() < PROVIDER_TOKEN_TTL
    }) {
        return Ok(value.value.clone());
    }

    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(credentials.key_id.clone());
    let iat = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let value = encode(
        &header,
        &ProviderClaims {
            iss: &credentials.team_id,
            iat,
        },
        &EncodingKey::from_ec_pem(credentials.private_key.as_bytes())
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    *cached = Some(CachedProviderToken {
        credentials_id,
        created_at: Instant::now(),
        value: value.clone(),
    });
    Ok(value)
}

#[cfg(test)]
mod tests {
    #[test]
    fn validates_native_device_tokens() {
        assert!(super::validate_registration(&"a".repeat(64), "sandbox").is_ok());
        assert!(super::validate_registration("not-hex", "sandbox").is_err());
        assert!(super::validate_registration(&"a".repeat(64), "staging").is_err());
    }

    #[test]
    fn approval_push_contains_action_identifiers() {
        let paths = vec!["src/app.ts".to_string()];
        let payload = super::ApprovalPayload {
            aps: super::Aps {
                alert: super::Alert {
                    title: "Poly needs approval",
                    body: "Change files",
                },
                sound: "default",
                category: "approval_requested",
                thread_id: "conversation-1",
            },
            kind: "approval-requested",
            conversation_id: "conversation-1",
            request_id: "request-1",
            approval_id: "approval-1",
            action: "Change files",
            command: None,
            paths: &paths,
            cwd: Some("/tmp/project"),
        };

        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["aps"]["category"], "approval_requested");
        assert_eq!(json["requestId"], "request-1");
        assert_eq!(json["approvalId"], "approval-1");
        assert_eq!(super::truncate_push_value("abcdef", 3), "abc");
    }
}
