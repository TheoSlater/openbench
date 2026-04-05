use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, SqlitePool};
use std::str::FromStr;
use tauri::{AppHandle, Manager, Runtime};

pub async fn get_db_pool<R: Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    // The chat.db file is in the app data dir.
    // However, the SQL plugin might be using a different path if not configured.
    // By default, it uses the app name.
    
    let db_path = app_dir.join("chat.db");
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    
    let options = SqliteConnectOptions::from_str(&db_url)
        .map_err(|e| e.to_string())?
        .create_if_missing(true);
        
    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| e.to_string())?;
        
    Ok(pool)
}
