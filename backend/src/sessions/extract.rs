//! Axum extractors that resolve the caller's session.

use axum::{extract::FromRequestParts, http::request::Parts};

use super::service::{self, SessionState, ValidSession};
use crate::{error::AppError, state::AppState};

/// Any valid session, including pre auth. Only a few routes accept this.
#[derive(Debug, Clone)]
pub struct AnySession(pub ValidSession);

/// A session that has completed the master password proof.
#[derive(Debug, Clone)]
pub struct FullSession(pub ValidSession);

impl FromRequestParts<AppState> for AnySession {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        if let Some(s) = parts.extensions.get::<ValidSession>() {
            return Ok(Self(s.clone()));
        }
        let s = service::validate(state, &parts.headers).await?;
        parts.extensions.insert(s.clone());
        Ok(Self(s))
    }
}

impl FromRequestParts<AppState> for FullSession {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let AnySession(s) = AnySession::from_request_parts(parts, state).await?;
        if s.state != SessionState::Full {
            return Err(AppError::Forbidden("vault-locked"));
        }
        Ok(Self(s))
    }
}
