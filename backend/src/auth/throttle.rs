//! Per account exponential backoff stored in the database so it holds across replicas.
//!
//! Rows are keyed by an HMAC of the normalised username. Unknown usernames are throttled
//! exactly like real ones, so backoff behaviour cannot be used to probe for accounts.
//! There is no permanent lockout, the delay is capped so an attacker cannot lock a
//! victim out for long.

use std::time::Duration;

use sqlx::PgExecutor;
use time::OffsetDateTime;

use crate::error::AppError;

/// Failures allowed before any delay applies.
pub const FREE_ATTEMPTS: i32 = 4;
pub const MAX_DELAY_SECS: f64 = 900.0;

pub async fn check(db: impl PgExecutor<'_>, key: &[u8; 32]) -> Result<(), AppError> {
    let next = sqlx::query_scalar!(
        "select next_allowed_at from login_throttle where key_hash = $1",
        &key[..]
    )
    .fetch_optional(db)
    .await?;
    let now = OffsetDateTime::now_utc();
    match next {
        Some(t) if t > now => Err(AppError::TooManyRequests {
            retry_after: Duration::try_from(t - now).unwrap_or(Duration::from_secs(1)),
        }),
        _ => Ok(()),
    }
}

/// The delay after the n-th consecutive failure is 2 to the power of (n minus 5) seconds,
/// starting at the 5th failure and capped at fifteen minutes.
pub async fn record_failure(db: impl PgExecutor<'_>, key: &[u8; 32]) -> Result<(), AppError> {
    sqlx::query!(
        "insert into login_throttle (key_hash, failures, next_allowed_at, updated_at)
         values ($1, 1, now(), now())
         on conflict (key_hash) do update set
           failures = login_throttle.failures + 1,
           updated_at = now(),
           next_allowed_at = now() + make_interval(secs => case
             when login_throttle.failures + 1 > $2
             then least(power(2, login_throttle.failures + 1 - $2 - 1), $3)
             else 0 end)",
        &key[..],
        FREE_ATTEMPTS,
        MAX_DELAY_SECS
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn reset(db: impl PgExecutor<'_>, key: &[u8; 32]) -> Result<(), AppError> {
    sqlx::query!("delete from login_throttle where key_hash = $1", &key[..])
        .execute(db)
        .await?;
    Ok(())
}

pub async fn delete_stale(db: impl PgExecutor<'_>, ttl: Duration) -> sqlx::Result<u64> {
    Ok(sqlx::query!(
        "delete from login_throttle
         where updated_at <= now() - make_interval(secs => $1) and next_allowed_at <= now()",
        ttl.as_secs_f64()
    )
    .execute(db)
    .await?
    .rows_affected())
}
