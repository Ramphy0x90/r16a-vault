//! SQL for the OIDC tables.

use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

pub struct FlowRow {
    pub nonce: String,
    pub pkce_verifier: String,
    pub client: String,
    pub browser_binding: Option<Vec<u8>>,
    pub mobile_challenge: Option<String>,
    pub expires_at: OffsetDateTime,
}

pub struct NewFlow<'a> {
    pub state_hash: &'a [u8],
    pub nonce: &'a str,
    pub pkce_verifier: &'a str,
    pub client: &'a str,
    pub browser_binding: Option<&'a [u8]>,
    pub mobile_challenge: Option<&'a str>,
    pub expires_at: OffsetDateTime,
}

pub async fn insert_flow(db: impl PgExecutor<'_>, f: &NewFlow<'_>) -> sqlx::Result<()> {
    sqlx::query!(
        "insert into oidc_flows (state_hash, nonce, pkce_verifier, client, browser_binding, mobile_challenge, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)",
        f.state_hash,
        f.nonce,
        f.pkce_verifier,
        f.client,
        f.browser_binding,
        f.mobile_challenge,
        f.expires_at
    )
    .execute(db)
    .await?;
    Ok(())
}

/// Deletes and returns the flow in one statement, so a state value can be used only once.
pub async fn take_flow(db: impl PgExecutor<'_>, state_hash: &[u8]) -> sqlx::Result<Option<FlowRow>> {
    sqlx::query_as!(
        FlowRow,
        "delete from oidc_flows where state_hash = $1
         returning nonce, pkce_verifier, client, browser_binding, mobile_challenge, expires_at",
        state_hash
    )
    .fetch_optional(db)
    .await
}

pub async fn user_by_identity(db: impl PgExecutor<'_>, issuer: &str, subject: &str) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        "select id from users where oidc_issuer = $1 and oidc_subject = $2",
        issuer,
        subject
    )
    .fetch_optional(db)
    .await
}

pub async fn insert_pending(
    db: impl PgExecutor<'_>,
    token_hash: &[u8],
    issuer: &str,
    subject: &str,
    suggested: Option<&str>,
    expires_at: OffsetDateTime,
) -> sqlx::Result<()> {
    sqlx::query!(
        "insert into oidc_pending (token_hash, issuer, subject, suggested_username, expires_at)
         values ($1, $2, $3, $4, $5)",
        token_hash,
        issuer,
        subject,
        suggested,
        expires_at
    )
    .execute(db)
    .await?;
    Ok(())
}

pub struct PendingRow {
    pub issuer: String,
    pub subject: String,
    pub suggested_username: Option<String>,
}

pub async fn peek_pending(db: impl PgExecutor<'_>, token_hash: &[u8]) -> sqlx::Result<Option<PendingRow>> {
    sqlx::query_as!(
        PendingRow,
        "select issuer, subject, suggested_username from oidc_pending where token_hash = $1 and expires_at > now()",
        token_hash
    )
    .fetch_optional(db)
    .await
}

pub async fn take_pending(db: impl PgExecutor<'_>, token_hash: &[u8]) -> sqlx::Result<Option<PendingRow>> {
    sqlx::query_as!(
        PendingRow,
        "delete from oidc_pending where token_hash = $1 and expires_at > now()
         returning issuer, subject, suggested_username",
        token_hash
    )
    .fetch_optional(db)
    .await
}

pub struct NewCode<'a> {
    pub code_hash: &'a [u8],
    pub challenge: &'a str,
    pub kind: &'a str,
    pub session_id: Option<Uuid>,
    pub issuer: Option<&'a str>,
    pub subject: Option<&'a str>,
    pub suggested_username: Option<&'a str>,
    pub expires_at: OffsetDateTime,
}

pub async fn insert_code(db: impl PgExecutor<'_>, c: &NewCode<'_>) -> sqlx::Result<()> {
    sqlx::query!(
        "insert into oidc_exchange_codes (code_hash, challenge, kind, session_id, issuer, subject, suggested_username, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)",
        c.code_hash,
        c.challenge,
        c.kind,
        c.session_id,
        c.issuer,
        c.subject,
        c.suggested_username,
        c.expires_at
    )
    .execute(db)
    .await?;
    Ok(())
}

pub struct CodeRow {
    pub challenge: String,
    pub kind: String,
    pub session_id: Option<Uuid>,
    pub issuer: Option<String>,
    pub subject: Option<String>,
    pub suggested_username: Option<String>,
}

pub async fn take_code(db: impl PgExecutor<'_>, code_hash: &[u8]) -> sqlx::Result<Option<CodeRow>> {
    sqlx::query_as!(
        CodeRow,
        "delete from oidc_exchange_codes where code_hash = $1 and expires_at > now()
         returning challenge, kind, session_id, issuer, subject, suggested_username",
        code_hash
    )
    .fetch_optional(db)
    .await
}

pub async fn delete_expired(db: impl PgExecutor<'_> + Copy) -> sqlx::Result<u64> {
    let a = sqlx::query!("delete from oidc_flows where expires_at <= now()")
        .execute(db)
        .await?;
    let b = sqlx::query!("delete from oidc_pending where expires_at <= now()")
        .execute(db)
        .await?;
    let c = sqlx::query!("delete from oidc_exchange_codes where expires_at <= now()")
        .execute(db)
        .await?;
    Ok(a.rows_affected() + b.rows_affected() + c.rows_affected())
}
