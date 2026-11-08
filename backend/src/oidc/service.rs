//! OIDC rules. State, nonce, PKCE, issuer, audience and signature are all checked, and
//! every value that crosses the browser or the app boundary is single use and short lived.

use std::time::Duration;

use axum::http::HeaderMap;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use openidconnect::{
    AuthorizationCode, CsrfToken, Nonce, PkceCodeChallenge, PkceCodeVerifier, Scope, TokenResponse,
    core::CoreAuthenticationFlow,
};
use subtle::ConstantTimeEq;
use time::OffsetDateTime;

use super::{cookies, repository};
use crate::{
    auth::username,
    crypto,
    error::AppError,
    sessions::{self, SessionState, service::ValidSession},
    state::AppState,
};

pub const FLOW_TTL: Duration = Duration::from_secs(600);
pub const CODE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientKind {
    Web,
    Mobile,
}

impl ClientKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Mobile => "mobile",
        }
    }
}

fn random_token() -> Result<String, AppError> {
    Ok(URL_SAFE_NO_PAD.encode(crypto::random_bytes::<32>()?))
}

/// An S256 challenge is the base64url SHA-256 of the verifier, always 43 characters.
fn valid_challenge(c: &str) -> bool {
    c.len() == 43 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn s256(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(crypto::sha256(verifier.as_bytes()))
}

pub struct Started {
    pub redirect: String,
    pub browser_cookie: Option<String>,
}

pub async fn start(state: &AppState, client: ClientKind, mobile_challenge: Option<&str>) -> Result<Started, AppError> {
    let provider = state.oidc.as_ref().ok_or(AppError::NotFound)?;
    let cfg = state.config.oidc.as_ref().ok_or(AppError::NotFound)?;
    if client == ClientKind::Mobile && !mobile_challenge.is_some_and(valid_challenge) {
        return Err(AppError::BadRequest("invalid-challenge"));
    }
    let oidc = provider.client(false).await?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let mut request = oidc
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .set_pkce_challenge(pkce_challenge);
    for scope in &cfg.scopes {
        request = request.add_scope(Scope::new(scope.clone()));
    }
    let (url, csrf, nonce) = request.url();

    let browser_cookie = match client {
        ClientKind::Web => Some(random_token()?),
        ClientKind::Mobile => None,
    };
    let binding = browser_cookie.as_deref().map(|c| crypto::sha256(c.as_bytes()));
    repository::insert_flow(
        &state.db,
        &repository::NewFlow {
            state_hash: &crypto::sha256(csrf.secret().as_bytes()),
            nonce: nonce.secret(),
            pkce_verifier: pkce_verifier.secret(),
            client: client.as_str(),
            browser_binding: binding.as_ref().map(|b| &b[..]),
            mobile_challenge: mobile_challenge.filter(|_| client == ClientKind::Mobile),
            expires_at: OffsetDateTime::now_utc() + FLOW_TTL,
        },
    )
    .await?;
    Ok(Started {
        redirect: url.to_string(),
        browser_cookie,
    })
}

/// Where the browser goes after the callback, plus any cookies to set.
pub enum Outcome {
    WebPreAuth { session_token: String },
    WebPending { pending_token: String },
    Mobile { code: String },
}

pub struct Callback {
    pub client: ClientKind,
    pub outcome: Result<Outcome, &'static str>,
}

/// Handles the provider redirect. Errors are returned as slugs so the handler can send the
/// user back to a friendly page instead of a bare problem document.
pub async fn callback(
    state: &AppState,
    code: &str,
    state_param: &str,
    headers: &HeaderMap,
) -> Result<Callback, AppError> {
    let flow = repository::take_flow(&state.db, &crypto::sha256(state_param.as_bytes()))
        .await?
        .ok_or(AppError::BadRequest("oidc-state"))?;
    let client = if flow.client == "mobile" {
        ClientKind::Mobile
    } else {
        ClientKind::Web
    };
    if flow.expires_at <= OffsetDateTime::now_utc() {
        return Ok(Callback {
            client,
            outcome: Err("oidc-expired"),
        });
    }
    if client == ClientKind::Web {
        let presented = cookies::read(headers, cookies::flow_name(&state.config)).map(|c| crypto::sha256(c.as_bytes()));
        let bound = match (presented, flow.browser_binding.as_deref()) {
            (Some(p), Some(b)) => bool::from(p.as_slice().ct_eq(b)),
            _ => false,
        };
        if !bound {
            return Ok(Callback {
                client,
                outcome: Err("oidc-browser"),
            });
        }
    }

    let (issuer, subject, suggested) = match verify(state, code, &flow).await {
        Ok(identity) => identity,
        Err(e) => {
            tracing::warn!(error = %e, "oidc callback rejected");
            return Ok(Callback {
                client,
                outcome: Err("oidc-failed"),
            });
        }
    };

    let outcome = match repository::user_by_identity(&state.db, &issuer, &subject).await? {
        Some(user_id) => {
            let issued = sessions::service::issue(state, &state.db, user_id, SessionState::PreAuth, headers).await?;
            match client {
                ClientKind::Web => Outcome::WebPreAuth {
                    session_token: issued.token,
                },
                ClientKind::Mobile => {
                    let code = random_token()?;
                    repository::insert_code(
                        &state.db,
                        &repository::NewCode {
                            code_hash: &crypto::sha256(code.as_bytes()),
                            challenge: flow.mobile_challenge.as_deref().unwrap_or_default(),
                            kind: "pre_auth",
                            session_id: Some(issued.session_id),
                            issuer: None,
                            subject: None,
                            suggested_username: None,
                            expires_at: OffsetDateTime::now_utc() + CODE_TTL,
                        },
                    )
                    .await?;
                    Outcome::Mobile { code }
                }
            }
        }
        None if !state.config.registration_enabled => {
            return Ok(Callback {
                client,
                outcome: Err("registration-disabled"),
            });
        }
        None => match client {
            ClientKind::Web => {
                let token = random_token()?;
                repository::insert_pending(
                    &state.db,
                    &crypto::sha256(token.as_bytes()),
                    &issuer,
                    &subject,
                    suggested.as_deref(),
                    OffsetDateTime::now_utc() + FLOW_TTL,
                )
                .await?;
                Outcome::WebPending { pending_token: token }
            }
            ClientKind::Mobile => {
                let code = random_token()?;
                repository::insert_code(
                    &state.db,
                    &repository::NewCode {
                        code_hash: &crypto::sha256(code.as_bytes()),
                        challenge: flow.mobile_challenge.as_deref().unwrap_or_default(),
                        kind: "pending",
                        session_id: None,
                        issuer: Some(&issuer),
                        subject: Some(&subject),
                        suggested_username: suggested.as_deref(),
                        expires_at: OffsetDateTime::now_utc() + CODE_TTL,
                    },
                )
                .await?;
                Outcome::Mobile { code }
            }
        },
    };
    Ok(Callback {
        client,
        outcome: Ok(outcome),
    })
}

/// Exchanges the code with PKCE and validates the ID token. A signature failure triggers one
/// metadata refresh and retry, which covers a key rotation at the provider.
async fn verify(
    state: &AppState,
    code: &str,
    flow: &repository::FlowRow,
) -> Result<(String, String, Option<String>), String> {
    let provider = state.oidc.as_ref().ok_or("disabled")?;
    let oidc = provider.client(false).await.map_err(|e| e.to_string())?;
    let response = oidc
        .exchange_code(AuthorizationCode::new(code.to_owned()))
        .map_err(|e| format!("token endpoint {e}"))?
        .set_pkce_verifier(PkceCodeVerifier::new(flow.pkce_verifier.clone()))
        .request_async(&provider.http)
        .await
        .map_err(|e| format!("code exchange {e}"))?;
    let id_token = response.id_token().ok_or("no id token")?;
    let nonce = Nonce::new(flow.nonce.clone());
    let claims = match id_token.claims(&oidc.id_token_verifier(), &nonce) {
        Ok(c) => c.clone(),
        Err(first) => {
            let fresh = provider.client(true).await.map_err(|e| e.to_string())?;
            id_token
                .claims(&fresh.id_token_verifier(), &nonce)
                .map_err(|e| format!("id token {first} then {e}"))?
                .clone()
        }
    };
    let suggested = claims
        .preferred_username()
        .and_then(|u| username::normalize(u.as_str()).ok());
    Ok((claims.issuer().to_string(), claims.subject().to_string(), suggested))
}

pub struct Exchanged {
    pub token: String,
    pub pending: bool,
    pub suggested_username: Option<String>,
}

/// Redeems a mobile one time code. The verifier must hash to the challenge the app sent at
/// start, so another app that intercepts the custom scheme redirect gains nothing.
pub async fn exchange(state: &AppState, code: &str, verifier: &str) -> Result<Exchanged, AppError> {
    if state.oidc.is_none() {
        return Err(AppError::NotFound);
    }
    if code.len() > 64 || verifier.len() < 43 || verifier.len() > 128 {
        return Err(AppError::BadRequest("oidc-exchange"));
    }
    let row = repository::take_code(&state.db, &crypto::sha256(code.as_bytes()))
        .await?
        .ok_or(AppError::BadRequest("oidc-exchange"))?;
    if !bool::from(s256(verifier).as_bytes().ct_eq(row.challenge.as_bytes())) {
        return Err(AppError::BadRequest("oidc-exchange"));
    }
    match (row.kind.as_str(), row.session_id) {
        ("pre_auth", Some(session_id)) => {
            let session = sqlx::query_scalar!(
                "select user_id from sessions where id = $1 and state = 'pre_auth'",
                session_id
            )
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::BadRequest("oidc-exchange"))?;
            let valid = ValidSession {
                id: session_id,
                user_id: session,
                state: SessionState::PreAuth,
                via_cookie: false,
            };
            let issued = sessions::service::rotate(state, &valid, SessionState::PreAuth).await?;
            Ok(Exchanged {
                token: issued.token,
                pending: false,
                suggested_username: None,
            })
        }
        ("pending", _) => {
            let (issuer, subject) = row
                .issuer
                .zip(row.subject)
                .ok_or(AppError::BadRequest("oidc-exchange"))?;
            let token = random_token()?;
            repository::insert_pending(
                &state.db,
                &crypto::sha256(token.as_bytes()),
                &issuer,
                &subject,
                row.suggested_username.as_deref(),
                OffsetDateTime::now_utc() + FLOW_TTL,
            )
            .await?;
            Ok(Exchanged {
                token,
                pending: true,
                suggested_username: row.suggested_username,
            })
        }
        _ => Err(AppError::BadRequest("oidc-exchange")),
    }
}

/// Reads the pending token from the web cookie or the mobile header.
pub fn pending_token<'a>(state: &AppState, headers: &'a HeaderMap) -> Option<&'a str> {
    headers
        .get("x-r16a-oidc-pending")
        .and_then(|v| v.to_str().ok())
        .or_else(|| cookies::read(headers, cookies::pending_name(&state.config)))
}
