//! SQL for the credentials table. Every statement is scoped by `user_id`, which is the
//! only thing standing between one user and another user's rows.

use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

pub struct CredentialRow {
    pub id: Uuid,
    pub meta_ct: Vec<u8>,
    pub secret_ct: Vec<u8>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

pub async fn list(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<Vec<CredentialRow>> {
    sqlx::query_as!(
        CredentialRow,
        "select id, meta_ct, secret_ct, created_at, updated_at from credentials
         where user_id = $1 order by created_at, id",
        user_id
    )
    .fetch_all(db)
    .await
}

pub async fn count(db: impl PgExecutor<'_>, user_id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"select count(*) as "n!" from credentials where user_id = $1"#,
        user_id
    )
    .fetch_one(db)
    .await
}

/// Returns None when the id already exists, for this user or any other.
pub async fn insert(
    db: impl PgExecutor<'_>,
    id: Uuid,
    user_id: Uuid,
    meta: &[u8],
    secret: &[u8],
) -> sqlx::Result<Option<CredentialRow>> {
    sqlx::query_as!(
        CredentialRow,
        "insert into credentials (id, user_id, meta_ct, secret_ct) values ($1, $2, $3, $4)
         on conflict (id) do nothing
         returning id, meta_ct, secret_ct, created_at, updated_at",
        id,
        user_id,
        meta,
        secret
    )
    .fetch_optional(db)
    .await
}

pub async fn delete(db: impl PgExecutor<'_>, id: Uuid, user_id: Uuid) -> sqlx::Result<bool> {
    Ok(
        sqlx::query!("delete from credentials where id = $1 and user_id = $2", id, user_id)
            .execute(db)
            .await?
            .rows_affected()
            == 1,
    )
}
