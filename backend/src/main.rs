#![forbid(unsafe_code)]

use std::{net::SocketAddr, process::ExitCode, time::Duration};

use r16a_vault_backend::{MIGRATOR, app, config::Config, sessions, state::AppState};
use secrecy::ExposeSecret;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

fn init_tracing(json: bool) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));
    let registry = tracing_subscriber::registry().with(filter);
    if json {
        registry.with(fmt::layer().json().with_current_span(true)).init();
    } else {
        registry.with(fmt::layer()).init();
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    // Debug builds pick up backend/.env so `cargo run` works without exporting variables.
    // Release builds, and therefore every container, read the real environment only.
    #[cfg(debug_assertions)]
    let _ = dotenvy::dotenv();
    let command = std::env::args().nth(1).unwrap_or_else(|| String::from("serve"));
    // Health checks and migrations run with a reduced environment, so they must not
    // require the full server configuration.
    match command.as_str() {
        "healthcheck" => return healthcheck(),
        "migrate" => {
            init_tracing(std::env::var("R16A_LOG_FORMAT").as_deref() != Ok("pretty"));
            return report(migrate().await);
        }
        "serve" => {}
        other => {
            eprintln!("unknown command {other}, expected serve, migrate or healthcheck");
            return ExitCode::from(2);
        }
    }
    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("configuration error {e}");
            return ExitCode::from(2);
        }
    };
    init_tracing(config.log_json);
    report(serve(config).await)
}

fn report(result: Result<(), String>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!(error = %e, "fatal");
            ExitCode::FAILURE
        }
    }
}

/// Probes `/readyz` over plain TCP. The distroless image has no shell or curl, so the
/// binary checks itself.
fn healthcheck() -> ExitCode {
    use std::io::{Read, Write};
    let bind = std::env::var("R16A_BIND").unwrap_or_else(|_| String::from("0.0.0.0:8081"));
    let port = bind.rsplit(':').next().unwrap_or("8081");
    let probe = || -> std::io::Result<bool> {
        let addr: SocketAddr = format!("127.0.0.1:{port}")
            .parse()
            .map_err(|_| std::io::Error::other("bad port"))?;
        let mut s = std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
        s.set_read_timeout(Some(Duration::from_secs(3)))?;
        s.write_all(b"GET /readyz HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
        let mut buf = [0u8; 16];
        let n = s.read(&mut buf)?;
        Ok(buf[..n].starts_with(b"HTTP/1.1 200") || buf[..n].starts_with(b"HTTP/1.0 200"))
    };
    match probe() {
        Ok(true) => ExitCode::SUCCESS,
        _ => ExitCode::FAILURE,
    }
}

/// Runs migrations with the owner role, which is the only role allowed to change the schema.
async fn migrate() -> Result<(), String> {
    let url = std::env::var("R16A_MIGRATE_DATABASE_URL")
        .or_else(|_| std::env::var("R16A_DATABASE_URL"))
        .map_err(|_| String::from("R16A_MIGRATE_DATABASE_URL or R16A_DATABASE_URL is required"))?;
    run_migrations(&url).await
}

async fn run_migrations(url: &str) -> Result<(), String> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(30))
        .connect(url)
        .await
        .map_err(|e| format!("database connection failed {e}"))?;
    MIGRATOR.run(&pool).await.map_err(|e| format!("migration failed {e}"))?;
    tracing::info!("migrations applied");
    Ok(())
}

async fn serve(config: Config) -> Result<(), String> {
    if config.migrate_on_start {
        let url = config.migrate_database_url.as_ref().unwrap_or(&config.database_url);
        run_migrations(url.expose_secret()).await?;
    }
    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect(config.database_url.expose_secret())
        .await
        .map_err(|e| format!("database connection failed {e}"))?;

    let bind = config.bind;
    let state = AppState::new(pool, config).map_err(|e| format!("state init failed {e}"))?;
    sessions::cleanup::spawn(state.clone());
    prefetch_oidc(&state);

    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| format!("bind {bind} failed {e}"))?;
    tracing::info!(%bind, "listening");
    axum::serve(
        listener,
        app::router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|e| format!("server error {e}"))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
    tracing::info!("shutting down");
}

/// Fetches the OIDC discovery document at startup, so a misconfigured issuer shows up in the
/// logs right away instead of at the first sign in. Retries with backoff and never blocks
/// serving, because local accounts work without the provider.
fn prefetch_oidc(state: &AppState) {
    let Some(provider) = state.oidc.clone() else {
        return;
    };
    tokio::spawn(async move {
        let mut delay = Duration::from_secs(2);
        for attempt in 1..=6 {
            match provider.client(true).await {
                Ok(_) => {
                    tracing::info!("oidc provider discovered");
                    return;
                }
                Err(e) => tracing::warn!(attempt, error = %e, "oidc discovery failed, retrying"),
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(60));
        }
        tracing::error!("oidc discovery keeps failing, single sign on will retry on first use");
    });
}
