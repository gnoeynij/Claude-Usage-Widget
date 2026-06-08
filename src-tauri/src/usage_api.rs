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
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
    #[serde(rename = "rateLimitTier")]
    rate_limit_tier: Option<String>,
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

/// Pull the raw OAuth secret string. macOS reads from the login Keychain
/// (where Claude Code CLI stores it by default — service
/// "Claude Code-credentials", account = $USER) via the `security` CLI; the
/// `keyring` Rust crate's query path silently fails to match the item that
/// Claude Code writes, but the CLI works. Falls back to
/// `~/.claude/.credentials.json` for users who have that file (Linux/Windows
/// also take this path). The JSON shape is identical across platforms.
fn read_credentials_raw() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(user) = std::env::var("USER") {
            match std::process::Command::new("security")
                .args([
                    "find-generic-password",
                    "-a",
                    &user,
                    "-s",
                    "Claude Code-credentials",
                    "-w",
                ])
                .output()
            {
                Ok(o) if o.status.success() => {
                    if let Ok(s) = String::from_utf8(o.stdout) {
                        return Some(s.trim().to_string());
                    }
                }
                Ok(o) => log::warn!(
                    "keychain: security CLI exit={:?} stderr={}",
                    o.status.code(),
                    String::from_utf8_lossy(&o.stderr).trim()
                ),
                Err(e) => log::warn!("keychain: security CLI spawn failed: {}", e),
            }
        }
    }
    let path = credentials_path()?;
    std::fs::read_to_string(path).ok()
}

fn read_credentials() -> Option<OAuthBlock> {
    let raw = read_credentials_raw()?;
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

/// `extra_usage` carries the separate-credit pool introduced by the
/// 2026-06-15 "automated workloads move off the subscription limit" policy.
/// Only meaningful when `is_enabled`; otherwise the widget hides it.
#[derive(Deserialize, Debug, Default)]
struct ExtraUsageBlock {
    #[serde(default)]
    is_enabled: bool,
    #[serde(default)]
    utilization: Option<f64>,
}

#[derive(Deserialize, Debug, Default)]
struct UsageResponse {
    #[serde(default)]
    five_hour: UsageBlock,
    #[serde(default)]
    seven_day: UsageBlock,
    #[serde(default)]
    seven_day_sonnet: UsageBlock,
    // Opus has its own weekly cap on some plans; the API sends `null` when the
    // account has no Opus-specific weekly limit, so this must be Option — a bare
    // UsageBlock would fail to deserialize the null.
    #[serde(default)]
    seven_day_opus: Option<UsageBlock>,
    #[serde(default)]
    extra_usage: ExtraUsageBlock,
}

#[derive(Serialize, Default, Debug)]
pub struct UsageOutput {
    pub five_hour: f64,
    pub seven_day: f64,
    pub seven_day_sonnet: f64,
    /// `None` when the account has no Opus-specific weekly cap (API sent null);
    /// the frontend hides the row in that case.
    pub seven_day_opus: Option<f64>,
    pub extra_usage_enabled: bool,
    pub extra_usage: Option<f64>,
    pub session_resets_at: Option<String>,
    pub weekly_resets_at: Option<String>,
}

#[derive(Serialize, Default, Debug)]
pub struct PlanOutput {
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

/// Read the subscription plan (e.g. "max") + rate-limit tier (e.g.
/// "default_claude_max_20x") from the stored credentials. Read-only and
/// independent of token expiry — the plan label should still render even when
/// the access token needs a refresh. Returns an empty struct when not signed in.
pub fn read_plan() -> PlanOutput {
    match read_credentials() {
        Some(o) => PlanOutput {
            subscription_type: o.subscription_type,
            rate_limit_tier: o.rate_limit_tier,
        },
        None => PlanOutput::default(),
    }
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

    Ok(UsageOutput {
        five_hour: body.five_hour.utilization.unwrap_or(0.0),
        seven_day: body.seven_day.utilization.unwrap_or(0.0),
        seven_day_sonnet: body.seven_day_sonnet.utilization.unwrap_or(0.0),
        seven_day_opus: body.seven_day_opus.and_then(|b| b.utilization),
        extra_usage_enabled: body.extra_usage.is_enabled,
        extra_usage: if body.extra_usage.is_enabled {
            body.extra_usage.utilization
        } else {
            None
        },
        session_resets_at: body.five_hour.resets_at,
        weekly_resets_at: body.seven_day.resets_at,
    })
}
