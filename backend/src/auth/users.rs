//! SQL for the users table.

use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

pub struct UserRow {
    pub id: Uuid,
    pub username: String,
    pub auth_hash: String,
    pub kdf_salt: Vec<u8>,
    pub kdf_opslimit: i32,
    pub kdf_memlimit: i64,
    pub wrapped_vault_key: Vec<u8>,
    pub created_at: OffsetDateTime,
}

pub struct NewUser<'a> {
    pub username: &'a str,
    pub auth_hash: &'a str,
    pub kdf_salt: &'a [u8],
    pub kdf_opslimit: i32,
    pub kdf_memlimit: i64,
    pub wrapped_vault_key: &'a [u8],
    pub oidc_issuer: Option<&'a str>,
    pub oidc_subject: Option<&'a str>,
}

pub async fn find_by_username(db: impl PgExecutor<'_>, username: &str) -> sqlx::Result<Option<UserRow>> {
    sqlx::query_as!(
        UserRow,
        "select id, username, auth_hash, kdf_salt, kdf_opslimit, kdf_memlimit, wrapped_vault_key, created_at
         from users where username = $1",
        username
    )
    .fetch_optional(db)
    .await
}

pub async fn find_by_id(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<Option<UserRow>> {
    sqlx::query_as!(
        UserRow,
        "select id, username, auth_hash, kdf_salt, kdf_opslimit, kdf_memlimit, wrapped_vault_key, created_at
         from users where id = $1",
        id
    )
    .fetch_optional(db)
    .await
}

/// Returns None when the username is already taken.
pub async fn insert(db: impl PgExecutor<'_>, u: &NewUser<'_>) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        "insert into users (username, auth_hash, kdf_salt, kdf_opslimit, kdf_memlimit, wrapped_vault_key,
                            oidc_issuer, oidc_subject)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing
         returning id",
        u.username,
        u.auth_hash,
        u.kdf_salt,
        u.kdf_opslimit,
        u.kdf_memlimit,
        u.wrapped_vault_key,
        u.oidc_issuer,
        u.oidc_subject
    )
    .fetch_optional(db)
    .await
}

pub async fn update_auth_hash(db: impl PgExecutor<'_>, id: Uuid, auth_hash: &str) -> sqlx::Result<()> {
    sqlx::query!(
        "update users set auth_hash = $2, updated_at = now() where id = $1",
        id,
        auth_hash
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn update_credentials_material(
    db: impl PgExecutor<'_>,
    id: Uuid,
    auth_hash: &str,
    kdf_salt: &[u8],
    kdf_opslimit: i32,
    kdf_memlimit: i64,
    wrapped_vault_key: &[u8],
) -> sqlx::Result<()> {
    sqlx::query!(
        "update users set auth_hash = $2, kdf_salt = $3, kdf_opslimit = $4, kdf_memlimit = $5,
         wrapped_vault_key = $6, updated_at = now() where id = $1",
        id,
        auth_hash,
        kdf_salt,
        kdf_opslimit,
        kdf_memlimit,
        wrapped_vault_key
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn delete(db: impl PgExecutor<'_>, id: Uuid) -> sqlx::Result<()> {
    sqlx::query!("delete from users where id = $1", id).execute(db).await?;
    Ok(())
}
