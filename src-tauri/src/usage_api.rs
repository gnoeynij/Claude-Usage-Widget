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

/// One entry of the `limits` array — the labeled per-limit surface the
/// official apps render from (2026-07-21 live probe: kinds `session` /
/// `weekly_all` / `weekly_scoped`, the scoped entry carrying
/// `scope.model.display_name` "Fable"). This replaced the fixed
/// `seven_day_sonnet`-style fields: the server can re-scope the per-model cap
/// (Sonnet → Fable → whatever ships next) without a schema change, so the
/// widget renders whatever arrives instead of hardcoding a model row.
/// Every field is Option per the §gotcha: bare fields fail the whole response
/// on explicit null — and the array itself guards element-level nulls.
#[derive(Deserialize, Debug, Default)]
struct LimitEntry {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    percent: Option<f64>,
    #[serde(default)]
    scope: Option<LimitScope>,
    #[serde(default)]
    resets_at: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct LimitScope {
    #[serde(default)]
    model: Option<LimitScopeModel>,
    #[serde(default)]
    surface: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct LimitScopeModel {
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct UsageResponse {
    #[serde(default)]
    five_hour: UsageBlock,
    #[serde(default)]
    seven_day: UsageBlock,
    // Option like seven_day_opus: the API sends `null` for this block on some
    // plans/rollouts, and a bare UsageBlock fails the whole response on null.
    #[serde(default)]
    seven_day_sonnet: Option<UsageBlock>,
    // Opus has its own weekly cap on some plans; the API sends `null` when the
    // account has no Opus-specific weekly limit, so this must be Option — a bare
    // UsageBlock would fail to deserialize the null.
    #[serde(default)]
    seven_day_opus: Option<UsageBlock>,
    // Same null-safety as seven_day_opus: the API may send `extra_usage: null`
    // for accounts without a separate-credit pool. A bare struct would fail the
    // whole response on explicit null (serde `default` fills only *absent* fields).
    #[serde(default)]
    extra_usage: Option<ExtraUsageBlock>,
    // Vec<Option<...>> so a null *element* inside the array can't fail the
    // whole response either (array-level cousin of the §gotcha above).
    #[serde(default)]
    limits: Option<Vec<Option<LimitEntry>>>,
}

/// Extract renderable scoped weekly rows (`weekly_scoped` kind) from the
/// `limits` array. Label preference: model display name → surface → generic.
/// Entries without a percent are dropped — nothing to draw.
fn scoped_from_limits(limits: Option<Vec<Option<LimitEntry>>>) -> Vec<ScopedLimitOut> {
    limits
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|e| e.kind.as_deref() == Some("weekly_scoped"))
        .filter_map(|e| {
            let percent = e.percent?;
            let scope = e.scope.unwrap_or_default();
            let label = scope
                .model
                .and_then(|m| m.display_name)
                .or(scope.surface)
                .unwrap_or_else(|| "Model".to_string());
            Some(ScopedLimitOut { label, percent, resets_at: e.resets_at })
        })
        .collect()
}

#[derive(Serialize, Default, Debug)]
pub struct UsageOutput {
    pub five_hour: f64,
    pub seven_day: f64,
    /// `None` when the API nulls/omits the fixed Sonnet weekly cap — which is
    /// its steady state since the labeled `limits` array replaced the fixed
    /// per-model fields (2026-07-21 probe). The frontend hides the legacy row
    /// then, same as seven_day_opus, instead of showing a misleading 0%.
    pub seven_day_sonnet: Option<f64>,
    /// `None` when the account has no Opus-specific weekly cap (API sent null);
    /// the frontend hides the row in that case.
    pub seven_day_opus: Option<f64>,
    pub extra_usage_enabled: bool,
    pub extra_usage: Option<f64>,
    pub session_resets_at: Option<String>,
    pub weekly_resets_at: Option<String>,
    /// Scoped weekly caps from the `limits` array (e.g. the Fable-only cap the
    /// official apps show). Empty when the API sends none — the frontend then
    /// falls back to the legacy sonnet/opus rows.
    pub scoped_limits: Vec<ScopedLimitOut>,
}

#[derive(Serialize, Debug)]
pub struct ScopedLimitOut {
    pub label: String,
    pub percent: f64,
    /// Reset time of this scoped cap (weekly cadence per the 2026-07-21 probe).
    /// The frontend projects "at this pace" against it, same as the all-models
    /// weekly row; absent → the row renders without a projection.
    pub resets_at: Option<String>,
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

    // Read as text first so a parse failure can log the actual body — the
    // endpoint sometimes returns HTTP 200 with a body that doesn't fit
    // UsageResponse (schema drift / intermittent non-JSON). The body is usage
    // utilization + reset times only (no token), safe to log a short preview.
    let text = resp.text().await.context("JSON_PARSE_ERROR")?;
    let body: UsageResponse = serde_json::from_str(&text).map_err(|e| {
        let preview: String = text.chars().take(300).collect();
        warn!("usage parse failed: {e}; body[..300]={preview:?}");
        anyhow!("JSON_PARSE_ERROR")
    })?;

    let extra = body.extra_usage.unwrap_or_default();
    Ok(UsageOutput {
        five_hour: body.five_hour.utilization.unwrap_or(0.0),
        seven_day: body.seven_day.utilization.unwrap_or(0.0),
        seven_day_sonnet: body.seven_day_sonnet.and_then(|b| b.utilization),
        seven_day_opus: body.seven_day_opus.and_then(|b| b.utilization),
        extra_usage_enabled: extra.is_enabled,
        extra_usage: if extra.is_enabled { extra.utilization } else { None },
        session_resets_at: body.five_hour.resets_at,
        weekly_resets_at: body.seven_day.resets_at,
        scoped_limits: scoped_from_limits(body.limits),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Regression: optional top-level usage blocks must tolerate an explicit
    // `null` (not just absence). serde's `default` fills only *absent* fields,
    // so a bare struct field fails the *entire* response on `null` — which would
    // blank the whole usage panel, not just that one row.
    #[test]
    fn usage_response_tolerates_null_and_missing_optional_blocks() {
        let variants = [
            r#"{"five_hour":{"utilization":50.0},"seven_day":{"utilization":60.0},"seven_day_sonnet":{"utilization":0.0},"seven_day_opus":null,"extra_usage":null}"#,
            r#"{"five_hour":{"utilization":50.0},"seven_day_opus":{"utilization":10.0},"extra_usage":{"is_enabled":true,"utilization":42.0}}"#,
            r#"{"five_hour":{"utilization":50.0},"seven_day":{"utilization":60.0}}"#,
            r#"{"extra_usage":{}}"#,
            // Regression (2026-06-25): the API began sending seven_day_sonnet:null
            // plus new per-block dollar fields (limit/used/remaining_dollars).
            // Neither may fail the whole response (sonnet was a bare struct before).
            r#"{"five_hour":{"utilization":8.0,"limit_dollars":null,"used_dollars":null,"remaining_dollars":null},"seven_day":{"utilization":50.0},"seven_day_sonnet":null}"#,
        ];
        for v in variants {
            let parsed: Result<UsageResponse, _> = serde_json::from_str(v);
            assert!(parsed.is_ok(), "should parse but failed: {v} -> {:?}", parsed.err());
        }
    }

    #[test]
    fn limits_array_tolerates_null_variants_and_extracts_scoped_rows() {
        // §gotcha 배열판: 배열 자체 null/누락 + 원소 null + percent/scope null —
        // 어느 것도 응답 전체 파싱을 깨면 안 된다.
        let variants = [
            r#"{"limits":null}"#,
            r#"{}"#,
            r#"{"limits":[]}"#,
            r#"{"limits":[null]}"#,
            r#"{"limits":[{"kind":"weekly_scoped","percent":null}]}"#,
            r#"{"limits":[{"kind":"weekly_scoped","percent":10.0,"scope":null}]}"#,
        ];
        for v in variants {
            let parsed: Result<UsageResponse, _> = serde_json::from_str(v);
            assert!(parsed.is_ok(), "should parse but failed: {v} -> {:?}", parsed.err());
        }

        // 2026-07-21 실측 형태: session/weekly_all 제외, weekly_scoped 만 추출,
        // 라벨은 display_name → surface 순 폴백, percent 없는 엔트리는 스킵.
        let body: UsageResponse = serde_json::from_str(
            r#"{"limits":[
                {"kind":"session","group":"session","percent":33.0,"severity":"normal","is_active":true},
                {"kind":"weekly_all","percent":8.0},
                null,
                {"kind":"weekly_scoped","percent":10.0,"scope":{"model":{"id":null,"display_name":"Fable"},"surface":null},"resets_at":"2026-07-23T00:00:00Z"},
                {"kind":"weekly_scoped","percent":null},
                {"kind":"weekly_scoped","percent":5.0,"scope":{"model":null,"surface":"Cowork"}}
            ]}"#,
        )
        .unwrap();
        let scoped = scoped_from_limits(body.limits);
        assert_eq!(scoped.len(), 2);
        assert_eq!(scoped[0].label, "Fable");
        assert_eq!(scoped[0].percent, 10.0);
        // resets_at threads through for the frontend projection; absent → None.
        assert_eq!(scoped[0].resets_at.as_deref(), Some("2026-07-23T00:00:00Z"));
        assert_eq!(scoped[1].label, "Cowork");
        assert!(scoped[1].resets_at.is_none());
    }

    #[test]
    fn extra_usage_hidden_when_disabled_or_null() {
        let disabled: UsageResponse =
            serde_json::from_str(r#"{"extra_usage":{"is_enabled":false,"utilization":99.0}}"#)
                .unwrap();
        assert!(!disabled.extra_usage.unwrap_or_default().is_enabled);

        let null: UsageResponse = serde_json::from_str(r#"{"extra_usage":null}"#).unwrap();
        assert!(!null.extra_usage.unwrap_or_default().is_enabled);
    }
}
