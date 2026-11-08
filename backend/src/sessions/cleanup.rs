//! Periodic housekeeping. Every statement is idempotent, so running this on several
//! replicas at once is harmless.

use std::time::Duration;

use crate::state::AppState;

const INTERVAL: Duration = Duration::from_secs(600);

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(INTERVAL);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            run_once(&state).await;
        }
    });
}

pub async fn run_once(state: &AppState) {
    let idle = state.config.session_idle.as_secs_f64();
    report(
        "expired sessions",
        super::repository::delete_expired(&state.db, idle).await,
    );
    report(
        "stale throttle rows",
        crate::auth::throttle::delete_stale(&state.db, state.config.throttle_ttl).await,
    );
    report(
        "expired oidc rows",
        crate::oidc::repository::delete_expired(&state.db).await,
    );
    state.ip_limiter.prune();
    state.prelogin_limiter.prune();
}

fn report(what: &str, result: sqlx::Result<u64>) {
    match result {
        Ok(0) => {}
        Ok(n) => tracing::info!(removed = n, "{what} removed"),
        Err(e) => tracing::warn!(error = %e, "{what} cleanup failed"),
    }
}
