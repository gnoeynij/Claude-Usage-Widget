// Cross-device combined lifetime cost, without a backend.
//
// Each device writes its own `<folder>/claude-widget/<device_id>.json` into a
// user-chosen cloud-synced folder (OneDrive / iCloud / Dropbox / Google Drive),
// then reads every sibling file and sums them. Each device owns exactly one
// file, so there are no write conflicts; the cloud provider handles propagation
// (eventual consistency — a combined total reflects each device's last sync).

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
struct DeviceCost {
    device_id: String,
    host: String,
    cost: f64,
    updated_at: String,
}

#[derive(Serialize, Default)]
pub struct CombinedOut {
    pub total: f64,
    pub devices: u32,
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

/// Write this device's lifetime cost into the shared folder, then sum every
/// device file found there (including this one).
pub fn sync(folder: &str, device_id: &str, cost: f64) -> std::io::Result<CombinedOut> {
    let dir = Path::new(folder).join("claude-widget");
    std::fs::create_dir_all(&dir)?;

    let me = DeviceCost {
        device_id: device_id.to_string(),
        host: hostname(),
        cost,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string(&me).unwrap_or_default();
    std::fs::write(dir.join(format!("{device_id}.json")), json)?;

    let mut total = 0.0_f64;
    let mut devices = 0u32;
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
                total += d.cost;
                devices += 1;
            }
        }
    }
    Ok(CombinedOut { total, devices })
}
