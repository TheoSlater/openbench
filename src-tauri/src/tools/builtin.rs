use super::{RegistryInner, Tool};
use chrono::{DateTime, Datelike, Duration, Utc};
use openbench_macros::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use sysinfo::System;

/// # Built-in Tools
///
/// This module contains the implementation of all native tools available in OpenBench.
/// Each tool is implemented as a struct with the `#[derive(Tool)]` macro.
///
/// To add a new tool:
/// 1. Define an arguments struct with `#[derive(JsonSchema, Deserialize)]`.
/// 2. Define a tool struct with `#[derive(Tool)]`.
/// 3. Implement `run(...)` for the tool struct.
/// 4. Register it in `register_all`.

pub(crate) fn register_all(registry: &mut RegistryInner) {
    registry.register(Box::new(GetCurrentTimestampTool));
    registry.register(Box::new(CalculateTimestampTool));
    registry.register(Box::new(ReadFileTool));
    registry.register(Box::new(ExecuteShellTool));
    registry.register(Box::new(WebSearchTool));
    registry.register(Box::new(SystemInfoTool));
}

// ---------------------------------------------------------------------------
// 1. GetCurrentTimestampTool
// ---------------------------------------------------------------------------

#[derive(Tool)]
#[tool(
    name = "get_current_timestamp",
    description = "Get the current date and time in ISO 8601 and Unix timestamp formats.",
    requires_approval = false
)]
pub struct GetCurrentTimestampTool;

impl GetCurrentTimestampTool {
    pub async fn run(&self) -> Result<String, String> {
        let now: DateTime<Utc> = Utc::now();
        Ok(format!(
            "ISO: {}, Unix: {}",
            now.to_rfc3339(),
            now.timestamp()
        ))
    }
}

// ---------------------------------------------------------------------------
// 2. CalculateTimestampTool
// ---------------------------------------------------------------------------

#[derive(JsonSchema, Deserialize)]
pub struct CalculateTimestampArgs {
    /// A relative time expression, e.g. '3 days ago', 'next friday', 'yesterday', 'tomorrow'
    pub expression: String,
}

#[derive(Tool)]
#[tool(
    name = "calculate_timestamp",
    description = "Calculate a timestamp relative to now. Supports expressions like '3 days ago', 'next friday', 'yesterday', 'tomorrow'.",
    args = "CalculateTimestampArgs",
    requires_approval = false
)]
pub struct CalculateTimestampTool;

impl CalculateTimestampTool {
    pub async fn run(&self, args: CalculateTimestampArgs) -> Result<String, String> {
        let now: DateTime<Utc> = Utc::now();
        let expr = args.expression.to_lowercase();

        let result = if expr.contains("ago") {
            let parts: Vec<&str> = expr.split_whitespace().collect();
            if parts.len() >= 2 {
                parts[0].parse::<i64>().ok().and_then(|num| {
                    let duration = match parts[1] {
                        "day" | "days" => Some(Duration::days(num)),
                        "hour" | "hours" => Some(Duration::hours(num)),
                        "minute" | "minutes" => Some(Duration::minutes(num)),
                        "week" | "weeks" => Some(Duration::weeks(num)),
                        _ => None,
                    };
                    duration.map(|d| now - d)
                })
            } else {
                None
            }
        } else if expr.contains("next") {
            let parts: Vec<&str> = expr.split_whitespace().collect();
            if parts.len() >= 2 {
                let target = match parts[1] {
                    "monday" => Some(chrono::Weekday::Mon),
                    "tuesday" => Some(chrono::Weekday::Tue),
                    "wednesday" => Some(chrono::Weekday::Wed),
                    "thursday" => Some(chrono::Weekday::Thu),
                    "friday" => Some(chrono::Weekday::Fri),
                    "saturday" => Some(chrono::Weekday::Sat),
                    "sunday" => Some(chrono::Weekday::Sun),
                    _ => None,
                };
                target.map(|tw| {
                    let mut current = now + Duration::days(1);
                    while current.weekday() != tw {
                        current = current + Duration::days(1);
                    }
                    current
                })
            } else {
                None
            }
        } else if expr == "yesterday" {
            Some(now - Duration::days(1))
        } else if expr == "tomorrow" {
            Some(now + Duration::days(1))
        } else {
            None
        };

        match result {
            Some(dt) => Ok(format!("Calculated: {}", dt.to_rfc3339())),
            None => Err("Error: Unsupported expression. Try '3 days ago', 'next friday', 'yesterday', 'tomorrow'.".to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// 3. ReadFileTool
// ---------------------------------------------------------------------------

#[derive(JsonSchema, Deserialize)]
pub struct ReadFileArgs {
    /// Absolute or relative path to the file to read
    pub path: String,
}

#[derive(Tool)]
#[tool(
    name = "read_file",
    description = "Read the contents of a file at the given path. Returns the full text content.",
    args = "ReadFileArgs",
    requires_approval = true
)]
pub struct ReadFileTool;

impl ReadFileTool {
    pub async fn run(&self, args: ReadFileArgs) -> Result<String, String> {
        tokio::fs::read_to_string(&args.path)
            .await
            .map_err(|e| format!("Error reading file: {}", e))
    }
}

// ---------------------------------------------------------------------------
// 4. ExecuteShellTool
// ---------------------------------------------------------------------------

#[derive(JsonSchema, Deserialize)]
pub struct ExecuteShellArgs {
    /// The shell command to execute (run via sh -c)
    pub command: String,
}

#[derive(Tool)]
#[tool(
    name = "execute_shell",
    description = "Execute a shell command and return its stdout and stderr. Use for system tasks, file operations, or running scripts.",
    args = "ExecuteShellArgs",
    requires_approval = true
)]
pub struct ExecuteShellTool;

impl ExecuteShellTool {
    pub async fn run(&self, args: ExecuteShellArgs) -> Result<String, String> {
        let output = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&args.command)
            .output()
            .await
            .map_err(|e| format!("Error executing shell command: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(format!("STDOUT:\n{}\nSTDERR:\n{}", stdout, stderr))
    }
}

// ---------------------------------------------------------------------------
// 5. WebSearchTool
// ---------------------------------------------------------------------------

#[derive(JsonSchema, Deserialize)]
pub struct WebSearchArgs {
    /// The search query
    pub query: String,
}

#[derive(Tool)]
#[tool(
    name = "search_web",
    description = "Search the web using DuckDuckGo. Returns raw HTML results (up to 4000 chars). No API key required.",
    args = "WebSearchArgs",
    requires_approval = false
)]
pub struct WebSearchTool;

impl WebSearchTool {
    pub async fn run(&self, args: WebSearchArgs) -> Result<String, String> {
        let query_encoded = args.query.replace(' ', "+");
        let url = format!("https://html.duckduckgo.com/html/?q={}", query_encoded);
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0")
            .build()
            .unwrap();

        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Error fetching search: {}", e))?;
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Error reading response: {}", e))?;
        Ok(text.chars().take(4000).collect())
    }
}

// ---------------------------------------------------------------------------
// 6. SystemInfoTool
// ---------------------------------------------------------------------------

#[derive(Tool)]
#[tool(
    name = "system_info",
    description = "Get information about the current system: OS, architecture, memory, hostname.",
    requires_approval = false
)]
pub struct SystemInfoTool;

impl SystemInfoTool {
    pub async fn run(&self) -> Result<String, String> {
        let mut sys = System::new_all();
        sys.refresh_all();

        let os_name = System::name().unwrap_or_else(|| "Unknown".to_string());
        let os_version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
        let arch = System::cpu_arch().unwrap_or_else(|| "Unknown".to_string());
        let hostname = System::host_name().unwrap_or_else(|| "Unknown".to_string());

        let total_mem = sys.total_memory() / 1024 / 1024; // MB
        let used_mem = sys.used_memory() / 1024 / 1024; // MB

        let cpu_count = sys.cpus().len();

        Ok(format!(
            "OS: {} {}\nArchitecture: {}\nHostname: {}\nMemory: {} MB / {} MB\nCPUs: {}",
            os_name, os_version, arch, hostname, used_mem, total_mem, cpu_count
        ))
    }
}
