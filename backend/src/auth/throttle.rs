//! Exponential backoff for password proofs, stored in the database so it holds across replicas.
//!
//! Every attempt is claimed atomically before the expensive Argon2 check runs. The claim is a
//! single upsert that only succeeds while the bucket is open, so a burst of parallel requests
//! cannot all slip through the same window. A successful proof deletes the bucket again.
//!
//! Buckets are keyed by HMACs, so the table never holds a username, an IP or a session id in
//! a form that can be read back. Three policies keep one attacker from locking out a victim
//! (SPEC 4.7).
//! - Anonymous logins are limited per account and source network, so bad guesses from one
//!   place do not block the owner signing in from elsewhere.
//! - An account wide bucket with a short cap bounds distributed guessing without ever
//!   blocking the owner for more than a minute.
//! - Proofs made from an existing session (unlock and sensitive account actions) use a bucket
//!   per session, so a stranger who only knows the username cannot touch them at all.

use std::{net::IpAddr, time::Duration};

use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{crypto, error::AppError};

/// How many failures a bucket absorbs before delays start, and the longest delay it imposes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Policy {
    pub free: i32,
    pub cap_secs: f64,
}

/// Anonymous login from one network. Delays double after the fifth failure, up to 15 minutes.
pub const PER_SOURCE: Policy = Policy {
    free: 4,
    cap_secs: 900.0,
};
/// Every anonymous login for one account. Generous, and capped at a minute, so a distributed
/// attacker is held to about one guess a minute while the owner never waits longer.
pub const PER_ACCOUNT: Policy = Policy {
    free: 20,
    cap_secs: 60.0,
};
/// Proofs inside an authenticated session, the same shape as a single source.
pub const PER_SESSION: Policy = Policy {
    free: 4,
    cap_secs: 900.0,
};

/// One bucket to claim before verifying a proof.
#[derive(Debug, Clone, Copy)]
pub struct Bucket {
    pub key: [u8; 32],
    pub policy: Policy,
}

/// IPv6 clients usually control a whole /64, so they share one source bucket.
fn network_of(ip: IpAddr) -> Vec<u8> {
    match ip {
        IpAddr::V4(v4) => v4.octets().to_vec(),
        IpAddr::V6(v6) => v6.octets()[..8].to_vec(),
    }
}

/// Buckets for an anonymous login of `username_norm` from `ip`.
pub fn login_buckets(secret: &[u8], username_norm: &str, ip: IpAddr) -> [Bucket; 2] {
    let mut source = username_norm.as_bytes().to_vec();
    source.push(0);
    source.extend(network_of(ip));
    [
        Bucket {
            key: crypto::hmac_sha256(secret, "r16a:throttle:source", &source),
            policy: PER_SOURCE,
        },
        Bucket {
            key: crypto::hmac_sha256(secret, "r16a:throttle:account", username_norm.as_bytes()),
            policy: PER_ACCOUNT,
        },
    ]
}

/// Bucket for a proof made from inside the session `session_id`.
pub fn session_bucket(secret: &[u8], session_id: Uuid) -> [Bucket; 1] {
    [Bucket {
        key: crypto::hmac_sha256(secret, "r16a:throttle:session", session_id.as_bytes()),
        policy: PER_SESSION,
    }]
}

/// Records an attempt if the bucket is open, otherwise refuses with the remaining wait.
///
/// The attempt is counted as a failure up front, which is what makes the claim atomic. The
/// delay for the n-th consecutive attempt is 2 to the power of (n minus free minus 1) seconds
/// once n exceeds `free`, capped at `cap_secs`.
pub async fn claim(db: impl PgExecutor<'_> + Copy, bucket: &Bucket) -> Result<(), AppError> {
    let claimed = sqlx::query_scalar!(
        r#"insert into login_throttle as t (key_hash, failures, next_allowed_at, updated_at)
           values ($1, 1, now(), now())
           on conflict (key_hash) do update set
             failures = t.failures + 1,
             updated_at = now(),
             next_allowed_at = now() + make_interval(secs => case
               when t.failures + 1 > $2 then least(power(2, t.failures + 1 - $2 - 1), $3)
               else 0 end)
           where t.next_allowed_at <= now()
           returning failures"#,
        &bucket.key[..],
        bucket.policy.free,
        bucket.policy.cap_secs
    )
    .fetch_optional(db)
    .await?;
    if claimed.is_some() {
        return Ok(());
    }
    let next = sqlx::query_scalar!(
        "select next_allowed_at from login_throttle where key_hash = $1",
        &bucket.key[..]
    )
    .fetch_optional(db)
    .await?;
    let wait = next.map_or(Duration::from_secs(1), |t| {
        Duration::try_from(t - OffsetDateTime::now_utc()).unwrap_or(Duration::from_secs(1))
    });
    Err(AppError::TooManyRequests {
        retry_after: wait.max(Duration::from_secs(1)),
    })
}

pub async fn reset(db: impl PgExecutor<'_>, bucket: &Bucket) -> Result<(), AppError> {
    sqlx::query!("delete from login_throttle where key_hash = $1", &bucket.key[..])
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
