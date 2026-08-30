//! Azalea bridge for latest azalea (git main) - JSON-lines protocol
//! Same protocol as main.rs but uses new azalea Account API

use std::{
    collections::VecDeque,
    io::{self, BufRead, Write},
    sync::Arc,
};

use azalea::prelude::*;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::{error, info, warn};
use uuid::Uuid;

fn emit(v: &Value) {
    let mut out = io::stdout();
    if writeln!(out, "{v}").is_ok() {
        let _ = out.flush();
    }
}

fn log_line(level: &str, line: impl AsRef<str>) {
    emit(&json!({ "ev": "log", "level": level, "line": line.as_ref() }));
}

fn parse_uuid(raw: &str) -> eyre::Result<Uuid> {
    let s = raw.trim().replace('-', "");
    if s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        let dashed = format!(
            "{}-{}-{}-{}-{}",
            &s[0..8],
            &s[8..12],
            &s[12..16],
            &s[16..20],
            &s[20..32]
        );
        return Ok(Uuid::parse_str(&dashed)?);
    }
    Ok(Uuid::parse_str(raw.trim())?)
}

#[derive(Debug, Deserialize)]
struct StartMsg {
    op: String,
    host: String,
    port: u16,
    username: String,
    uuid: String,
    token: String,
    #[serde(default)]
    proxy: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Cmd {
    op: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    dir: Option<String>,
    #[serde(default)]
    on: Option<bool>,
    #[serde(default)]
    slot: Option<u8>,
    #[serde(default)]
    ms: Option<u64>,
}

#[derive(Clone, Component, Default)]
struct State {
    cmds: Arc<Mutex<VecDeque<Cmd>>>,
    walk_until_tick: Arc<Mutex<Option<u32>>>,
    tick: Arc<Mutex<u32>>,
}

fn walk_dir(name: &str) -> azalea::WalkDirection {
    use azalea::WalkDirection::*;
    match name.to_ascii_lowercase().as_str() {
        "forward" | "w" => Forward,
        "back" | "backward" | "s" => Backward,
        "left" | "a" => Left,
        "right" | "d" => Right,
        "none" | "stop" => None,
        _ => None,
    }
}

fn apply_cmd(bot: &Client, state: &State, cmd: Cmd) {
    match cmd.op.as_str() {
        "chat" => {
            if let Some(text) = cmd.text {
                bot.chat(text);
            }
        }
        "disconnect" => {
            log_line("system", "Disconnect requested.");
            bot.disconnect();
        }
        "walk" => {
            let dir = cmd.dir.as_deref().unwrap_or("forward");
            let on = cmd.on.unwrap_or(true);
            if on {
                bot.walk(walk_dir(dir));
                if let Some(ms) = cmd.ms {
                    let ticks = ((ms as u32) / 50).max(1);
                    let now = *state.tick.lock();
                    *state.walk_until_tick.lock() = Some(now.saturating_add(ticks));
                }
            } else {
                bot.walk(azalea::WalkDirection::None);
                *state.walk_until_tick.lock() = None;
            }
        }
        "jump" => {
            bot.jump();
        }
        "sneak" => {
            let on = cmd.on.unwrap_or(true);
            bot.set_crouching(on);
        }
        "look" => {
            let pos = bot.position();
            bot.look_at(azalea::Vec3::new(pos.x + 2.0, pos.y + 1.6, pos.z));
        }
        "select" => {
            if let Some(slot) = cmd.slot {
                bot.set_selected_hotbar_slot(slot.min(8));
            }
        }
        "use" => {
            bot.start_use_item();
        }
        "drop" => {
            log_line("system", "Drop not wired yet.");
        }
        other => {
            warn!("unknown command op={other}");
        }
    }
}

fn facing_from_yaw(yaw_deg: f32) -> &'static str {
    let deg = ((yaw_deg % 360.0) + 360.0) % 360.0;
    let i = ((deg + 22.5) / 45.0).floor() as usize % 8;
    ["S", "SW", "W", "NW", "N", "NE", "E", "SE"][i]
}

fn snapshot(bot: &Client) -> Value {
    let pos = bot.position();
    let food = bot.hunger().food as f64;
    let dir = bot.direction();
    let yaw = dir.y_rot() as f64;
    let pitch = dir.x_rot() as f64;
    let slot = bot.selected_hotbar_slot();
    json!({
        "ev": "snapshot",
        "available": true,
        "username": bot.username(),
        "position": { "x": pos.x, "y": pos.y, "z": pos.z },
        "health": 20.0,
        "food": food,
        "yaw": yaw,
        "pitch": pitch,
        "facing": facing_from_yaw(dir.y_rot()),
        "dimension": "overworld",
        "timeOfDay": 0,
        "isDay": true,
        "heldItem": null,
        "lookingAt": null,
        "entities": [],
        "nearbyBlocks": [],
        "hotbar": (0..9).map(|i| json!({
            "slot": i,
            "name": null,
            "displayName": null,
            "count": 0,
            "selected": i == slot
        })).collect::<Vec<_>>(),
        "selectedSlot": slot,
        "using": false,
        "window": null
    })
}

async fn handle(bot: Client, event: Event, state: State) -> eyre::Result<()> {
    match event {
        Event::Init => {
            log_line("system", "Azalea client initialized.");
        }
        Event::Login => {
            log_line("system", "Logged in to the server.");
            emit(&json!({ "ev": "status", "status": "online" }));
        }
        Event::Spawn => {
            log_line(
                "system",
                format!("✅ Spawned as {} (Azalea latest).", bot.username()),
            );
            emit(&json!({ "ev": "status", "status": "online" }));
            emit(&snapshot(&bot));
        }
        Event::Chat(m) => {
            let line = m.message().to_string();
            if !line.is_empty() {
                emit(&json!({ "ev": "chat", "line": line }));
            }
        }
        Event::Tick => {
            let tick = {
                let mut t = state.tick.lock();
                *t = t.wrapping_add(1);
                *t
            };
            if let Some(until) = *state.walk_until_tick.lock() {
                if tick >= until {
                    bot.walk(azalea::WalkDirection::None);
                    *state.walk_until_tick.lock() = None;
                }
            }
            let cmds: Vec<Cmd> = {
                let mut q = state.cmds.lock();
                q.drain(..).collect()
            };
            for cmd in cmds {
                apply_cmd(&bot, &state, cmd);
            }
            if tick % 10 == 0 {
                emit(&snapshot(&bot));
            }
        }
        Event::Death(_) => {
            emit(&json!({ "ev": "death" }));
            log_line("system", "Died.");
        }
        Event::Disconnect(reason) => {
            let text = reason
                .map(|r| r.to_string())
                .unwrap_or_else(|| "disconnected".to_string());
            emit(&json!({ "ev": "error", "line": format!("Disconnected: {text}") }));
            emit(&json!({ "ev": "end", "line": text }));
        }
        _ => {}
    }
    Ok(())
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    log_line("system", "Azalea bridge starting (latest git).");

    let mut first = String::new();
    io::stdin().lock().read_line(&mut first)?;
    let start: StartMsg = serde_json::from_str(first.trim())
        .map_err(|e| eyre::eyre!("invalid start JSON: {e}"))?;
    if start.op != "start" {
        eyre::bail!("first message must be op=start, got {}", start.op);
    }

    let uuid = parse_uuid(&start.uuid)?;

    // New API: construct Account manually
    let account = azalea::Account {
        username: start.username.clone(),
        uuid: Some(uuid),
        access_token: Some(Arc::new(Mutex::new(start.token.clone()))),
        account_opts: azalea::AccountOpts::Offline,
        certs: Arc::new(Mutex::new(None)),
    };

    let address = format!("{}:{}", start.host, start.port);
    log_line(
        "system",
        format!("Connecting to {address} as {} ({}) via Azalea latest…", start.username, uuid),
    );

    let cmds: Arc<Mutex<VecDeque<Cmd>>> = Arc::new(Mutex::new(VecDeque::new()));
    let cmds_stdin = cmds.clone();
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let stdin = tokio::io::stdin();
        let mut lines = tokio::io::BufReader::new(stdin).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Cmd>(&line) {
                        Ok(cmd) => cmds_stdin.lock().push_back(cmd),
                        Err(e) => warn!("bad command JSON: {e} ({line})"),
                    }
                }
                Ok(None) => {
                    cmds_stdin.lock().push_back(Cmd {
                        op: "disconnect".into(),
                        text: None,
                        dir: None,
                        on: None,
                        slot: None,
                        ms: None,
                    });
                    break;
                }
                Err(e) => {
                    error!("stdin error: {e}");
                    break;
                }
            }
        }
    });

    let state = State {
        cmds,
        walk_until_tick: Arc::new(Mutex::new(None)),
        tick: Arc::new(Mutex::new(0)),
    };

    info!("joining {address}");
    ClientBuilder::new()
        .set_handler(handle)
        .set_state(state)
        .start(account, address.as_str())
        .await;

    emit(&json!({ "ev": "end", "line": "azalea exited" }));
    Ok(())
}
