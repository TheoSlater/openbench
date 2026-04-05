use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::str::FromStr;
use tauri::{AppHandle, Manager, Runtime};

pub async fn get_db_pool<R: Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, String> {
    println!("[db] get_db_pool starting...");
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            println!("[db] app_data_dir error: {}", e);
            e.to_string()
        })?;
    
    // The chat.db file is in the app data dir.
    // However, the SQL plugin might be using a different path if not configured.
    // By default, it uses the app name.
    
    let db_path = app_dir.join("chat.db");
    println!("[db] db_path: {}", db_path.display());
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    
    let options = SqliteConnectOptions::from_str(&db_url)
        .map_err(|e| {
            println!("[db] SqliteConnectOptions error: {}", e);
            e.to_string()
        })?
        .create_if_missing(true)
        .busy_timeout(std::time::Duration::from_secs(10));
        
    println!("[db] SqlitePool::connect_with calling (timeout 10s)...");
    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| {
            println!("[db] SqlitePool::connect_with error: {}", e);
            e.to_string()
        })?;
        
    println!("[db] SqlitePool::connect_with success");
    Ok(pool)
}
