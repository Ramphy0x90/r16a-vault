//! Session rules. Issuing, validating, sliding refresh and rotation.

use std::time::Duration;

use axum::http::HeaderMap;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use time::OffsetDateTime;
use uuid::Uuid;

use super::repository;
use crate::{
    crypto::{self, TOKEN_LEN},
    error::AppError,
    state::AppState,
};

/// Pre auth sessions exist only between an OIDC callback and the master password proof.
pub const PRE_AUTH_LIFETIME: Duration = Duration::from_secs(600);
/// Writing last_seen_at on every request would turn reads into writes, so it is
/// refreshed at most this often. Idle expiry is therefore accurate to about a minute.
const TOUCH_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    PreAuth,
    Full,
}

impl SessionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PreAuth => "pre_auth",
            Self::Full => "full",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "pre_auth" => Some(Self::PreAuth),
            "full" => Some(Self::Full),
            _ => None,
        }
    }
}

/// A freshly minted token. Only its hash is stored, so this value is the one and
/// only copy and must go straight to the client.
pub struct IssuedToken {
    pub session_id: Uuid,
    pub token: String,
}

impl std::fmt::Debug for IssuedToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IssuedToken")
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub struct ValidSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub state: SessionState,
    /// True when the token came from the cookie, which decides how a rotated token is returned.
    pub via_cookie: bool,
}

fn new_token() -> Result<(String, [u8; 32]), AppError> {
    let raw = zeroize::Zeroizing::new(crypto::random_bytes::<TOKEN_LEN>()?);
    let token = URL_SAFE_NO_PAD.encode(raw.as_slice());
    let hash = crypto::sha256(token.as_bytes());
    Ok((token, hash))
}

fn lifetime(state: &AppState, s: SessionState) -> Duration {
    match s {
        SessionState::Full => state.config.session_absolute,
        SessionState::PreAuth => PRE_AUTH_LIFETIME.min(state.config.session_absolute),
    }
}

pub async fn issue(
    state: &AppState,
    db: impl sqlx::PgExecutor<'_>,
    user_id: Uuid,
    session_state: SessionState,
    headers: &HeaderMap,
) -> Result<IssuedToken, AppError> {
    let (token, hash) = new_token()?;
    let expires_at = OffsetDateTime::now_utc() + lifetime(state, session_state);
    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|ua| ua.chars().take(256).collect::<String>());
    let session_id = repository::insert(
        db,
        user_id,
        &hash,
        session_state.as_str(),
        expires_at,
        user_agent.as_deref(),
    )
    .await?;
    Ok(IssuedToken { session_id, token })
}

/// Issues a new token for an existing session and invalidates the old one. A pre auth
/// session becoming full also receives a full lifetime from this moment.
pub async fn rotate(state: &AppState, session: &ValidSession, to: SessionState) -> Result<IssuedToken, AppError> {
    let (token, hash) = new_token()?;
    let expires_at = (session.state != to).then(|| OffsetDateTime::now_utc() + lifetime(state, to));
    repository::rotate(&state.db, session.id, &hash, to.as_str(), expires_at).await?;
    Ok(IssuedToken {
        session_id: session.id,
        token,
    })
}

/// Extracts the token from the bearer header first, then the cookie.
pub fn token_from_headers<'a>(headers: &'a HeaderMap, cookie_name: &str) -> Option<(&'a str, bool)> {
    if let Some(bearer) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        return Some((bearer.trim(), false));
    }
    super::cookie::read(headers, cookie_name).map(|t| (t, true))
}

pub async fn validate(state: &AppState, headers: &HeaderMap) -> Result<ValidSession, AppError> {
    let (token, via_cookie) =
        token_from_headers(headers, state.config.cookie_name()).ok_or(AppError::Unauthenticated)?;
    // A well formed token is exactly 43 base64url characters. Anything else is rejected
    // before touching the database.
    if token.len() != 43
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(AppError::Unauthenticated);
    }
    let hash = crypto::sha256(token.as_bytes());
    let row = repository::find_by_hash(&state.db, &hash)
        .await?
        .ok_or(AppError::Unauthenticated)?;

    let now = OffsetDateTime::now_utc();
    let idle_deadline = row.last_seen_at + state.config.session_idle;
    if now >= row.expires_at || now >= idle_deadline {
        repository::delete(&state.db, row.id).await?;
        return Err(AppError::Unauthenticated);
    }
    if now - row.last_seen_at >= TOUCH_INTERVAL {
        repository::touch(&state.db, row.id).await?;
    }
    let session_state = SessionState::parse(&row.state).ok_or_else(|| AppError::internal("unknown session state"))?;
    Ok(ValidSession {
        id: row.id,
        user_id: row.user_id,
        state: session_state,
        via_cookie,
    })
}
