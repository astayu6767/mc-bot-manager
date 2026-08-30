//! JSON-lines sidecar wrapping [Azalea](https://github.com/azalea-rs/azalea).
//!
//! Protocol (stdin = commands, stdout = events, stderr = tracing):
//!   first stdin line: {"op":"start","host","port","username","uuid","token","proxy"?}
//!   later commands:   {"op":"chat"|"disconnect"|"walk"|"jump"|"look"|"select"|"use"|"drop"|"sneak"}
//!   events:           {"ev":"log"|"chat"|"status"|"error"|"death"|"player_add"|"player_remove"|"snapshot"|"end", ...}

use std::{
    collections::VecDeque,
    future::Future,
    io::{self, BufRead, Write},
    net::ToSocketAddrs,
    pin::Pin,
    sync::Arc,
};

use azalea::{
    account::AccountTrait,
    prelude::*,
    protocol::connect::Proxy,
    ClientInformation, JoinOpts,
};
use azalea_auth::sessionserver::{
    join as session_join, ClientSessionServerError, SessionServerJoinOpts,
};
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

#[derive(Debug)]
struct TokenAccount {
    username: String,
    uuid: Uuid,
    access_token: Mutex<String>,
    certs: Mutex<Option<azalea_auth::certs::Certificates>>,
}

impl AccountTrait for TokenAccount {
    fn username(&self) -> &str {
        &self.username
    }
    fn uuid(&self) -> Uuid {
        self.uuid
    }
    fn access_token(&self) -> Option<String> {
        Some(self.access_token.lock().clone())
    }
    fn certs(&self) -> Option<azalea_auth::certs::Certificates> {
        self.certs.lock().clone()
    }
    fn set_certs(&self, certs: azalea_auth::certs::Certificates) {
        *self.certs.lock() = Some(certs);
    }
    fn join<'a>(
        &'a self,
        public_key: &'a [u8],
        private_key: &'a [u8; 16],
        server_id: &'a str,
        proxy: Option<reqwest::Proxy>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ClientSessionServerError>> + Send + 'a>> {
        Box::pin(async move {
            let access_token = self.access_token.lock().clone();
            session_join(SessionServerJoinOpts {
                access_token: &access_token,
                public_key,
                private_key: private_key.as_slice(),
                uuid: &self.uuid,
                server_id,
                proxy,
            })
            .await
        })
    }
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

fn parse_socks5(raw: &str) -> Option<Proxy> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let mut rest = s;
    if let Some(stripped) = rest
        .strip_prefix("socks5://")
        .or_else(|| rest.strip_prefix("socks5h://"))
        .or_else(|| rest.strip_prefix("socks://"))
    {
        rest = stripped;
    } else if rest.starts_with("socks4://") {
        warn!("Azalea only supports SOCKS5; ignoring SOCKS4 proxy");
        return None;
    }
    // Drop user:pass@ — Proxy::new auth is optional and we don't pull socks5-impl.
    if let Some(at) = rest.rfind('@') {
        rest = &rest[at + 1..];
    }
    let addr = rest
        .to_socket_addrs()
        .ok()
        .and_then(|mut i| i.next());
    match addr {
        Some(addr) => Some(Proxy::new(addr, None)),
        None => {
            warn!("Could not resolve SOCKS proxy address {rest}");
            None
        }
    }
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
            bot.exit();
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
            // Offset look-at a few blocks ahead so the head actually turns.
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
        "use_stop" => {
            // Releasing use is handled by the client after the item finishes;
            // a second start_use_item is a no-op for most items.
        }
        "drop" => {
            log_line("system", "Drop is not wired on the Azalea bridge yet.");
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
            bot.set_client_information(ClientInformation {
                view_distance: 12,
                ..Default::default()
            });
        }
        Event::Login => {
            log_line("system", "Logged in to the server.");
            emit(&json!({ "ev": "status", "status": "online" }));
        }
        Event::Spawn => {
            log_line(
                "system",
                format!("✅ Spawned in the world as {} (Azalea / vanilla physics).", bot.username()),
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
        Event::AddPlayer(info) => {
            let name = info.profile.name.clone();
            if !name.is_empty() {
                emit(&json!({ "ev": "player_add", "name": name }));
            }
        }
        Event::RemovePlayer(info) => {
            let name = info.profile.name.clone();
            if !name.is_empty() {
                emit(&json!({ "ev": "player_remove", "name": name }));
            }
        }
        Event::Disconnect(reason) => {
            let text = reason
                .map(|r| r.to_string())
                .unwrap_or_else(|| "disconnected".to_string());
            emit(&json!({ "ev": "error", "line": format!("Disconnected: {text}") }));
            emit(&json!({ "ev": "end", "line": text }));
            bot.exit();
        }
        Event::ConnectionFailed(err) => {
            let text = format!("Connection failed: {err}");
            emit(&json!({ "ev": "error", "line": text }));
            emit(&json!({ "ev": "end", "line": text }));
            bot.exit();
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

    log_line("system", "Azalea bridge starting (Minecraft 26.1 protocol).");

    let mut first = String::new();
    io::stdin().lock().read_line(&mut first)?;
    let start: StartMsg = serde_json::from_str(first.trim())
        .map_err(|e| eyre::eyre!("invalid start JSON: {e}"))?;
    if start.op != "start" {
        eyre::bail!("first message must be op=start, got {}", start.op);
    }

    let uuid = parse_uuid(&start.uuid)?;
    let account: Account = TokenAccount {
        username: start.username.clone(),
        uuid,
        access_token: Mutex::new(start.token.clone()),
        certs: Mutex::new(None),
    }
    .into();

    let address = format!("{}:{}", start.host, start.port);
    log_line(
        "system",
        format!(
            "Connecting to {address} as {} ({}) via Azalea…",
            start.username, uuid
        ),
    );

    let mut opts = JoinOpts::new();
    if let Some(raw) = start.proxy.as_deref().filter(|s| !s.is_empty()) {
        if let Some(proxy) = parse_socks5(raw) {
            log_line("system", "Routing Azalea through SOCKS5 proxy.");
            opts = opts.proxy(proxy);
        } else {
            log_line(
                "system",
                "Proxy string could not be parsed as SOCKS5; connecting directly.",
            );
        }
    }

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
        .reconnect_after(None)
        .start_with_opts(account, address.as_str(), opts)
        .await;

    emit(&json!({ "ev": "end", "line": "azalea exited" }));
    Ok(())
}
