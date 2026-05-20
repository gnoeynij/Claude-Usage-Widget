use anyhow::{anyhow, Context, Result};
use log::{info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

/// Shared HTTP client — reqwest's connection pool only kicks in when the same
/// Client is reused across requests. Building fresh each call defeats the
/// pool and triggers a full TLS handshake every time.
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("reqwest::Client build (rustls)")
});

#[derive(Deserialize, Debug)]
struct Credentials {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OAuthBlock>,
}

#[derive(Deserialize, Debug, Clone)]
struct OAuthBlock {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<f64>,
}

fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

/// Last-modified time of `~/.claude/.credentials.json` in ms since UNIX epoch,
/// or `None` if the file is missing/unreadable. Used by the frontend to detect
/// when Claude Code CLI has refreshed the token so the widget can auto-retry
/// after a `TOKEN_EXPIRED` state.
pub fn credentials_mtime_ms() -> Option<f64> {
    use std::time::UNIX_EPOCH;
    let path = credentials_path()?;
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let dur = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(dur.as_secs_f64() * 1000.0)
}

fn read_credentials() -> Option<OAuthBlock> {
    let path = credentials_path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: Credentials = serde_json::from_str(&raw).ok()?;
    let oauth = parsed.claude_ai_oauth?;
    if oauth.access_token.as_deref().unwrap_or("").is_empty() {
        return None;
    }
    Some(oauth)
}

fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[derive(Deserialize, Debug, Default)]
struct UsageBlock {
    #[serde(default)]
    utilization: Option<f64>,
    #[serde(default)]
    resets_at: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct ExtraUsage {
    #[serde(default)]
    is_enabled: Option<bool>,
}

#[derive(Deserialize, Debug, Default)]
struct UsageResponse {
    #[serde(default)]
    five_hour: UsageBlock,
    #[serde(default)]
    seven_day: UsageBlock,
    #[serde(default)]
    seven_day_sonnet: UsageBlock,
    #[serde(default)]
    extra_usage: ExtraUsage,
}

#[derive(Serialize, Default, Debug)]
pub struct UsageOutput {
    pub five_hour: f64,
    pub seven_day: f64,
    pub seven_day_sonnet: f64,
    pub session_resets_at: Option<String>,
    pub weekly_resets_at: Option<String>,
    pub plan_name: String,
    pub is_connected: bool,
}

pub async fn fetch_usage() -> Result<UsageOutput> {
    let creds = read_credentials().ok_or_else(|| anyhow!("NO_CREDENTIALS"))?;

    // Skip the round-trip if the token has already expired locally — but
    // give Claude Code one chance to have refreshed it in the meantime.
    if let Some(exp) = creds.expires_at {
        if exp > 0.0 && now_ms() >= exp {
            if let Some(fresh) = read_credentials() {
                if fresh.access_token != creds.access_token {
                    return call_usage(fresh.access_token.as_deref().unwrap_or("")).await;
                }
            }
            return Err(anyhow!("TOKEN_EXPIRED"));
        }
    }

    let access = creds.access_token.clone().unwrap_or_default();
    match call_usage(&access).await {
        Ok(out) => Ok(out),
        Err(e) if e.to_string() == "TOKEN_EXPIRED" => {
            if let Some(fresh) = read_credentials() {
                if fresh.access_token.as_deref() != Some(&access) {
                    return call_usage(fresh.access_token.as_deref().unwrap_or("")).await;
                }
            }
            Err(e)
        }
        Err(e) => Err(e),
    }
}

async fn call_usage(access_token: &str) -> Result<UsageOutput> {
    let start = std::time::Instant::now();
    let resp = match HTTP_CLIENT
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Distinguish DNS/network failures from API-side errors so users
            // attaching widget.log can answer the "is it the API or my net?"
            // question without us having to guess.
            warn!("usage_api: network error ({}ms): {}", start.elapsed().as_millis(), e);
            return Err(anyhow::Error::from(e).context("network error"));
        }
    };

    let status = resp.status();
    let elapsed = start.elapsed().as_millis();
    info!("usage_api: HTTP {} in {}ms", status.as_u16(), elapsed);
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(anyhow!("TOKEN_EXPIRED"));
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(anyhow!("RATE_LIMITED"));
    }
    if !status.is_success() {
        return Err(anyhow!("HTTP {}", status.as_u16()));
    }

    let body: UsageResponse = resp.json().await.context("JSON_PARSE_ERROR")?;

    let plan_name = if body.extra_usage.is_enabled.unwrap_or(false) {
        "Max (Extra)"
    } else {
        "Max"
    }
    .to_string();

    Ok(UsageOutput {
        five_hour: body.five_hour.utilization.unwrap_or(0.0),
        seven_day: body.seven_day.utilization.unwrap_or(0.0),
        seven_day_sonnet: body.seven_day_sonnet.utilization.unwrap_or(0.0),
        session_resets_at: body.five_hour.resets_at,
        weekly_resets_at: body.seven_day.resets_at,
        plan_name,
        is_connected: true,
    })
}
