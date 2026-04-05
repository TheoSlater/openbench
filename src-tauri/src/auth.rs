use bcrypt::{hash, verify, DEFAULT_COST};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Runtime};
use uuid::Uuid;
use chrono::{Utc, Duration};
use crate::db::get_db_pool;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    #[serde(rename = "fullName")]
    pub full_name: Option<String>,
    pub status: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub user: User,
    pub token: String,
}

#[command]
pub async fn auth_signup<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    password: String,
    full_name: Option<String>,
) -> Result<AuthResponse, String> {
    let pool = get_db_pool(&app).await?;
    
    // Check if user exists
    let existing = sqlx::query!("SELECT id FROM users WHERE email = ?", email)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;
        
    if existing.is_some() {
        return Err("User already exists".to_string());
    }

    let password_hash = hash(password, DEFAULT_COST).map_err(|e| e.to_string())?;
    let user_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    
    let user = User {
        id: user_id.clone(),
        email: email.clone(),
        full_name: full_name.clone(),
        status: "Active".to_string(),
        avatar_url: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    sqlx::query!(
        "INSERT INTO users (id, email, passwordHash, fullName, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        user.id, user.email, password_hash, user.full_name, user.status, user.created_at, user.updated_at
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let session_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().to_string();
    let expires_at = (Utc::now() + Duration::days(30)).to_rfc3339();

    sqlx::query!(
        "INSERT INTO sessions (id, userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)",
        session_id, user.id, token, expires_at, now
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(AuthResponse {
        user,
        token,
    })
}

#[command]
pub async fn auth_login<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    password: String,
) -> Result<AuthResponse, String> {
    let pool = get_db_pool(&app).await?;

    let row = sqlx::query!(
        "SELECT id, email, passwordHash, fullName, status, avatarUrl, createdAt, updatedAt FROM users WHERE email = ?",
        email
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Invalid email or password".to_string())?;

    if !verify(password, &row.passwordHash).map_err(|e| e.to_string())? {
        return Err("Invalid email or password".to_string());
    }

    let user = User {
        id: row.id.unwrap_or_default(),
        email: row.email,
        full_name: row.fullName,
        status: row.status.unwrap_or_else(|| "Active".to_string()),
        avatar_url: row.avatarUrl,
        created_at: row.createdAt.unwrap_or_default(),
        updated_at: row.updatedAt.unwrap_or_default(),
    };

    let session_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let expires_at = (Utc::now() + Duration::days(30)).to_rfc3339();

    sqlx::query!(
        "INSERT INTO sessions (id, userId, token, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)",
        session_id, user.id, token, expires_at, now
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(AuthResponse {
        user,
        token,
    })
}

#[command]
pub async fn auth_logout<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<(), String> {
    // In a real app, we'd need the token to delete it.
    // Since we don't have it here, we might need to pass it from frontend or 
    // manage it in app state.
    // For now, let's assume the frontend will pass it or we'll just return OK.
    Ok(())
}

#[command]
pub async fn auth_get_current_user<R: Runtime>(
    app: AppHandle<R>,
    token: String,
) -> Result<User, String> {
    println!("[auth] auth_get_current_user - token: {}", token);
    let pool = get_db_pool(&app).await?;
    println!("[auth] pool acquired");

    let now = Utc::now().to_rfc3339();
    let row = sqlx::query!(
        "SELECT u.id, u.email, u.fullName, u.status, u.avatarUrl, u.createdAt, u.updatedAt 
         FROM users u 
         JOIN sessions s ON u.id = s.userId 
         WHERE s.token = ? AND s.expiresAt > ?",
        token, now
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        println!("[auth] fetch_optional error: {}", e);
        e.to_string()
    })?
    .ok_or_else(|| {
        println!("[auth] session expired or not found");
        "Session expired".to_string()
    })?;

    println!("[auth] user retrieved: {}", row.email);

    Ok(User {
        id: row.id.unwrap_or_default(),
        email: row.email,
        full_name: row.fullName,
        status: row.status.unwrap_or_else(|| "Active".to_string()),
        avatar_url: row.avatarUrl,
        created_at: row.createdAt.unwrap_or_default(),
        updated_at: row.updatedAt.unwrap_or_default(),
    })
}

#[command]
pub async fn auth_update_status<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    status: String,
) -> Result<(), String> {
    let pool = get_db_pool(&app).await?;
    let now = Utc::now().to_rfc3339();

    sqlx::query!(
        "UPDATE users SET status = ?, updatedAt = ? WHERE id = (SELECT userId FROM sessions WHERE token = ?)",
        status, now, token
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
