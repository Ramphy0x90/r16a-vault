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
