//! rakit desktop: jendela Tauri + server rakit (Go) yang berjalan di komputer pengguna.
//!
//! Saat aplikasi dibuka:
//!   1. pilih port bebas di 127.0.0.1 dan token acak untuk masuk;
//!   2. jalankan sidecar `rakit` (server Go, lihat ../../go) dengan DESKTOP=1: data di folder data aplikasi,
//!      halaman & template dari resource bundle, website project di http://<slug>.localhost:<port>, dan mode Agen
//!      (Claude Agent SDK) dijalankan langsung dari runtime yang dibundel (resource `agent/`, tanpa Docker);
//!   3. tunggu server siap, lalu buka jendela di /desktop/start?token=… (masuk otomatis ke akun lokal).
//!
//! macOS: WKWebView tidak mengenal *.localhost, jadi webview memakai server lokal sebagai proxy HTTP
//! (DESKTOP_PROXY=1, fitur `macos-proxy`, macOS 14+). Windows (WebView2) dan Linux (WebKitGTK + nss-myhostname)
//! mengenal *.localhost sendiri.
//!
//! Saat aplikasi ditutup, server ikut dihentikan.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Proses server yang sedang berjalan (dihentikan saat aplikasi keluar).
struct Server(Mutex<Option<CommandChild>>);

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

fn random_token() -> String {
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).expect("sumber acak sistem");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Tunggu sampai server menerima koneksi (maks. `limit`).
fn wait_ready(port: u16, limit: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir: PathBuf = app.path().app_data_dir()?.join("data");
    fs::create_dir_all(&data_dir)?;
    let resources = app.path().resource_dir()?;
    let port = free_port()?;
    let token = random_token();

    let mut envs = vec![
        ("HOST", "127.0.0.1".to_string()),
        ("PORT", port.to_string()),
        ("BASE_DOMAIN", "localhost".to_string()),
        ("PROTOCOL", "http".to_string()),
        ("DATA_DIR", data_dir.to_string_lossy().into_owned()),
        ("PUBLIC_DIR", resources.join("public").to_string_lossy().into_owned()),
        ("TEMPLATE_DIR", resources.join("templates").join("default").to_string_lossy().into_owned()),
        ("DESKTOP", "1".to_string()),
        ("DESKTOP_TOKEN", token.clone()),
        // Versi terpasang, untuk notifikasi update (server membandingkannya dengan GitHub Releases).
        ("APP_VERSION", app.package_info().version.to_string()),
        // Mode Agen (Claude Agent SDK) tanpa Docker: runtime dibundel (scripts/build-agent-runtime.sh).
        ("AI_AGENT_ENGINES", "claude".to_string()),
        ("AI_AGENT_LOCAL", resources.join("agent").to_string_lossy().into_owned()),
        (
            "AI_AGENT_NODE",
            resources
                .join("agent")
                .join("node")
                .join(if cfg!(windows) { "node.exe" } else { "node" })
                .to_string_lossy()
                .into_owned(),
        ),
        // Satu pengguna lokal: batas project lebih longgar.
        ("MAX_PROJECTS", "100".to_string()),
        ("MAX_CUSTOM_DOMAINS", "100".to_string()),
    ];
    if cfg!(target_os = "macos") {
        envs.push(("DESKTOP_PROXY", "1".to_string()));
    }
    // .env opsional di folder data (mis. AI_BASE_URL/AI_API_KEY untuk AI bersama), dibaca server bila ada.
    let env_file = data_dir.join(".env");
    let mut args = vec![];
    if env_file.exists() {
        args.push("--env-file".to_string());
        args.push(env_file.to_string_lossy().into_owned());
    }

    let (mut events, child) = app
        .shell()
        .sidecar("rakit")?
        .args(args)
        .envs(envs)
        .current_dir(&resources)
        .spawn()?;
    app.state::<Server>().0.lock().unwrap().replace(child);

    // Log server ke <data>/server.log.
    let log_path = data_dir.join("server.log");
    tauri::async_runtime::spawn(async move {
        let mut log = OpenOptions::new().create(true).append(true).open(log_path).ok();
        while let Some(event) = events.recv().await {
            let line = match event {
                CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => b,
                CommandEvent::Terminated(t) => format!("server berhenti: {:?}\n", t.code).into_bytes(),
                _ => continue,
            };
            if let Some(f) = log.as_mut() {
                let _ = f.write_all(&line);
            }
        }
    });

    if !wait_ready(port, Duration::from_secs(20)) {
        return Err("server lokal tidak menyala dalam 20 detik (lihat server.log di folder data)".into());
    }

    let url = format!("http://localhost:{port}/desktop/start?token={token}").parse()?;
    #[allow(unused_mut)]
    let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("rakit")
        .inner_size(1360.0, 860.0)
        .min_inner_size(900.0, 600.0);
    #[cfg(target_os = "macos")]
    {
        window = window.proxy_url(format!("http://127.0.0.1:{port}").parse()?);
    }
    window.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(err) = start(&handle) {
                eprintln!("rakit: gagal menyalakan server lokal: {err}");
                return Err(err);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("membangun aplikasi rakit")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Server>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
