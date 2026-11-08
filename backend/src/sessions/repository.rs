//! SQL for the sessions table.

use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

pub struct SessionRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub state: String,
    pub last_seen_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
}

pub async fn insert(
    db: impl PgExecutor<'_>,
    user_id: Uuid,
    token_hash: &[u8],
    state: &str,
    expires_at: OffsetDateTime,
    user_agent: Option<&str>,
) -> sqlx::Result<Uuid> {
    sqlx::query_scalar!(
        "insert into sessions (user_id, token_hash, state, expires_at, user_agent)
         values ($1, $2, $3, $4, $5) returning id",
        user_id,
        token_hash,
        state,
        expires_at,
        user_agent
    )
    .fetch_one(db)
    .await
}

pub async fn find_by_hash(db: impl PgExecutor<'_>, token_hash: &[u8]) -> sqlx::Result<Option<SessionRow>> {
    sqlx::query_as!(
        SessionRow,
        "select id, user_id, state, last_seen_at, expires_at from sessions where token_hash = $1",
        token_hash
    )
    .fetch_optional(db)
    .await
}

pub async fn touch(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("update sessions set last_seen_at = now() where id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

/// Replaces the token, state and optionally the deadline in one statement, so the
/// old token stops working at the same instant the new one starts.
pub async fn rotate(
    db: impl PgExecutor<'_>,
    id: Uuid,
    new_hash: &[u8],
    state: &str,
    expires_at: Option<OffsetDateTime>,
) -> sqlx::Result<()> {
    sqlx::query!(
        "update sessions set token_hash = $2, state = $3, expires_at = coalesce($4, expires_at),
         last_seen_at = now() where id = $1",
        id,
        new_hash,
        state,
        expires_at
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn delete(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("delete from sessions where id = $1", id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn delete_all_for_user(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<u64> {
    Ok(sqlx::query!("delete from sessions where user_id = $1", user_id)
        .execute(db)
        .await?
        .rows_affected())
}

pub async fn delete_others_for_user(db: impl PgExecutor<'_>, user_id: Uuid, keep: Uuid) -> sqlx::Result<u64> {
    Ok(
        sqlx::query!("delete from sessions where user_id = $1 and id <> $2", user_id, keep)
            .execute(db)
            .await?
            .rows_affected(),
    )
}

pub async fn delete_expired(db: impl PgExecutor<'_>, idle_secs: f64) -> sqlx::Result<u64> {
    Ok(sqlx::query!(
        "delete from sessions where expires_at <= now() or last_seen_at <= now() - make_interval(secs => $1)",
        idle_secs
    )
    .execute(db)
    .await?
    .rows_affected())
}

/// Owner of a session that is still waiting for its master password proof.
pub async fn user_of_pre_auth(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar!("select user_id from sessions where id = $1 and state = 'pre_auth'", id)
        .fetch_optional(db)
        .await
}

/// Cheapest possible round trip, used by the readiness probe.
pub async fn ping(db: impl PgExecutor<'_>) -> sqlx::Result<()> {
    sqlx::query_scalar!(r#"select 1 as "one!""#)
        .fetch_one(db)
        .await
        .map(|_| ())
}

pub struct SessionSummary {
    pub id: Uuid,
    pub state: String,
    pub user_agent: Option<String>,
    pub created_at: OffsetDateTime,
    pub last_seen_at: OffsetDateTime,
}

/// The user's live sessions, most recently active first.
pub async fn list_for_user(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Vec<SessionSummary>> {
    sqlx::query_as!(
        SessionSummary,
        "select id, state, user_agent, created_at, last_seen_at from sessions
         where user_id = $1 and expires_at > now() order by last_seen_at desc",
        user_id
    )
    .fetch_all(db)
    .await
}

/// Removes one session of this user. Another user's session id simply matches nothing.
pub async fn delete_for_user(db: impl PgExecutor<'_>, user_id: Uuid, id: Uuid) -> sqlx::Result<bool> {
    Ok(
        sqlx::query!("delete from sessions where id = $1 and user_id = $2", id, user_id)
            .execute(db)
            .await?
            .rows_affected()
            == 1,
    )
}
