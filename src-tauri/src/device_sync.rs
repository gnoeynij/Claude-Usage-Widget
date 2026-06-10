// Cross-device combined lifetime cost, without a backend.
//
// Each device writes its own `<folder>/claude-widget/<device_id>.json` into a
// user-chosen cloud-synced folder (OneDrive / iCloud / Dropbox / Google Drive),
// then reads every sibling file and sums them. Each device owns exactly one
// file, so there are no write conflicts; the cloud provider handles propagation
// (eventual consistency — a combined total reflects each device's last sync).
//
// Since v2.4 the file also carries `daily` — the device's durable per-day ×
// per-family cost history (mirror of the frontend `costHistory`). Older device
// files without `daily` still parse (serde default) and contribute to the
// lifetime total only, so mixed-version fleets stay compatible.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct DayEntry {
    pub tokens: u64,
    pub cost: f64,
}

/// date "YYYY-MM-DD" → family → totals.
pub type DailyMap = HashMap<String, HashMap<String, DayEntry>>;

#[derive(Serialize, Deserialize)]
struct DeviceCost {
    device_id: String,
    host: String,
    cost: f64,
    updated_at: String,
    #[serde(default)]
    daily: DailyMap,
}

#[derive(Serialize, Default)]
pub struct CombinedOut {
    pub total: f64,
    pub devices: u32,
    /// Fleet-wide per-day × per-family sums (each device reports only its own
    /// local usage, so summing across files is the true combined history).
    pub daily: DailyMap,
}

/// Best-effort host label (display/debug only — the combined total keys on
/// device_id, not host). macOS often leaves these env vars unset → "device".
fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::env::var("HOSTNAME").ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "device".to_string())
}

/// Common cloud-synced folder roots that exist on this machine, for the
/// Settings picker. The user can still type any path manually.
pub fn detect_folders() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |p: std::path::PathBuf| {
        if p.is_dir() {
            if let Some(s) = p.to_str() {
                let s = s.to_string();
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    };
    if let Ok(od) = std::env::var("OneDrive") {
        push(std::path::PathBuf::from(od));
    }
    if let Some(home) = dirs::home_dir() {
        push(home.join("OneDrive"));
        push(home.join("Dropbox"));
        push(home.join("Google Drive"));
        push(home.join("iCloudDrive"));
        push(home.join("Library/Mobile Documents/com~apple~CloudDocs"));
    }
    out
}

fn merge_daily(into: &mut DailyMap, from: &DailyMap) {
    for (date, fams) in from {
        let day = into.entry(date.clone()).or_default();
        for (family, e) in fams {
            let acc = day.entry(family.clone()).or_default();
            acc.tokens += e.tokens;
            acc.cost += e.cost;
        }
    }
}

/// Write this device's lifetime cost + daily history into the shared folder,
/// then sum every device file found there (including this one).
pub fn sync(
    folder: &str,
    device_id: &str,
    cost: f64,
    daily: DailyMap,
) -> std::io::Result<CombinedOut> {
    let dir = Path::new(folder).join("claude-widget");
    std::fs::create_dir_all(&dir)?;

    let me = DeviceCost {
        device_id: device_id.to_string(),
        host: hostname(),
        cost,
        updated_at: chrono::Utc::now().to_rfc3339(),
        daily,
    };
    let json = serde_json::to_string(&me).unwrap_or_default();
    std::fs::write(dir.join(format!("{device_id}.json")), json)?;

    let mut out = CombinedOut::default();
    for entry in std::fs::read_dir(&dir)? {
        let path = match entry {
            Ok(e) => e.path(),
            Err(_) => continue,
        };
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(txt) = std::fs::read_to_string(&path) {
            if let Ok(d) = serde_json::from_str::<DeviceCost>(&txt) {
                out.total += d.cost;
                out.devices += 1;
                merge_daily(&mut out.daily, &d.daily);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(entries: &[(&str, u64, f64)]) -> HashMap<String, DayEntry> {
        entries
            .iter()
            .map(|(f, t, c)| (f.to_string(), DayEntry { tokens: *t, cost: *c }))
            .collect()
    }

    #[test]
    fn merge_daily_sums_per_date_and_family() {
        let mut a: DailyMap = HashMap::new();
        a.insert("2026-06-10".into(), day(&[("Opus", 100, 1.0), ("Fable", 10, 0.5)]));
        a.insert("2026-06-09".into(), day(&[("Opus", 50, 0.4)]));

        let mut b: DailyMap = HashMap::new();
        // Overlapping date+family sums; new family and new date append.
        b.insert("2026-06-10".into(), day(&[("Opus", 200, 2.0), ("Haiku", 5, 0.1)]));
        b.insert("2026-06-08".into(), day(&[("Sonnet", 30, 0.2)]));

        let mut combined: DailyMap = HashMap::new();
        merge_daily(&mut combined, &a);
        merge_daily(&mut combined, &b);

        let d10 = &combined["2026-06-10"];
        assert_eq!(d10["Opus"].tokens, 300);
        assert!((d10["Opus"].cost - 3.0).abs() < 1e-9);
        assert!((d10["Fable"].cost - 0.5).abs() < 1e-9);
        assert!((d10["Haiku"].cost - 0.1).abs() < 1e-9);
        assert!((combined["2026-06-09"]["Opus"].cost - 0.4).abs() < 1e-9);
        assert!((combined["2026-06-08"]["Sonnet"].cost - 0.2).abs() < 1e-9);
    }

    #[test]
    fn old_device_file_without_daily_still_parses() {
        // Pre-v2.4 file shape — `daily` absent must default to empty, not fail.
        let legacy = r#"{"device_id":"abc","host":"X","cost":12.5,"updated_at":"2026-06-09T00:00:00Z"}"#;
        let d: DeviceCost = serde_json::from_str(legacy).expect("legacy file must parse");
        assert!((d.cost - 12.5).abs() < 1e-9);
        assert!(d.daily.is_empty());
    }
}
