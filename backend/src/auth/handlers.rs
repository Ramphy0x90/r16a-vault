//! HTTP handlers for `/api/v1/auth`.

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};

use super::{
    dto::{
        AuthConfigResponse, AuthKeyProof, LoginRequest, LoginResponse, PreloginRequest, PreloginResponse,
        RegisterRequest, UnlockResponse, UserSummary,
    },
    service::{self, Authenticated},
};
use crate::{
    error::AppError,
    http::{client_ip::ClientIp, json::ApiJson, wire},
    sessions::{self, AnySession, FullSession},
    state::AppState,
};

fn login_response(
    state: &AppState,
    auth: Authenticated,
    client: super::dto::ClientKind,
    status: StatusCode,
) -> Result<Response, AppError> {
    let Authenticated { user, token } = auth;
    let body = LoginResponse {
        kdf: wire::KdfDto::from_params(service::kdf_of(&user)?),
        salt: wire::b64(&user.kdf_salt),
        wrapped_vault_key: wire::b64(&user.wrapped_vault_key),
        token: service::token_for_body(client, &token),
        user: UserSummary {
            id: user.id,
            username: user.username,
        },
    };
    let mut res = (status, Json(body)).into_response();
    if client == super::dto::ClientKind::Web {
        res.headers_mut()
            .append(header::SET_COOKIE, sessions::cookie::set(&state.config, &token.token));
    }
    Ok(res)
}

#[utoipa::path(get, path = "/api/v1/auth/config", tag = "auth",
    responses((status = 200, body = AuthConfigResponse)))]
pub async fn auth_config(State(state): State<AppState>) -> Json<AuthConfigResponse> {
    let oidc = state.config.oidc.as_ref();
    Json(AuthConfigResponse {
        registration_enabled: state.config.registration_enabled,
        oidc_enabled: oidc.is_some(),
        oidc_display_name: oidc.map(|o| o.display_name.clone()),
        privacy_url: state.config.privacy_url.clone(),
    })
}

#[utoipa::path(post, path = "/api/v1/auth/prelogin", tag = "auth", request_body = PreloginRequest,
    responses((status = 200, body = PreloginResponse), (status = 400), (status = 429)))]
pub async fn prelogin(
    State(state): State<AppState>,
    ip: ClientIp,
    ApiJson(req): ApiJson<PreloginRequest>,
) -> Result<Json<PreloginResponse>, AppError> {
    state.prelogin_limiter.check(ip.0)?;
    let p = service::prelogin(&state, &req.username).await?;
    Ok(Json(PreloginResponse {
        kdf: wire::KdfDto::from_params(p.kdf),
        salt: wire::b64(&p.salt),
    }))
}

#[utoipa::path(post, path = "/api/v1/auth/register", tag = "auth", request_body = RegisterRequest,
    responses((status = 201, body = LoginResponse), (status = 400), (status = 403), (status = 409), (status = 429)))]
pub async fn register(
    State(state): State<AppState>,
    ip: ClientIp,
    headers: HeaderMap,
    ApiJson(req): ApiJson<RegisterRequest>,
) -> Result<Response, AppError> {
    state.ip_limiter.check(ip.0)?;
    let linked = crate::oidc::service::pending_token(&state, &headers).is_some();
    let auth = service::register(&state, &req, &headers).await?;
    let mut res = login_response(&state, auth, req.client, StatusCode::CREATED)?;
    if linked {
        res.headers_mut()
            .append(header::SET_COOKIE, crate::oidc::cookies::clear_pending(&state.config));
    }
    Ok(res)
}

#[utoipa::path(post, path = "/api/v1/auth/login", tag = "auth", request_body = LoginRequest,
    responses((status = 200, body = LoginResponse), (status = 401), (status = 429)))]
pub async fn login(
    State(state): State<AppState>,
    ip: ClientIp,
    headers: HeaderMap,
    ApiJson(req): ApiJson<LoginRequest>,
) -> Result<Response, AppError> {
    state.ip_limiter.check(ip.0)?;
    let auth = service::login(&state, ip.0, &req.username, &req.auth_key, req.client, &headers).await?;
    login_response(&state, auth, req.client, StatusCode::OK)
}

#[utoipa::path(post, path = "/api/v1/auth/unlock", tag = "auth", request_body = AuthKeyProof,
    responses((status = 200, body = UnlockResponse), (status = 401), (status = 429)))]
pub async fn unlock(
    State(state): State<AppState>,
    ip: ClientIp,
    AnySession(session): AnySession,
    ApiJson(req): ApiJson<AuthKeyProof>,
) -> Result<Response, AppError> {
    state.ip_limiter.check(ip.0)?;
    let (user, token) = service::unlock(&state, &session, &req.auth_key).await?;
    let body = UnlockResponse {
        kdf: wire::KdfDto::from_params(service::kdf_of(&user)?),
        salt: wire::b64(&user.kdf_salt),
        wrapped_vault_key: wire::b64(&user.wrapped_vault_key),
        token: (!session.via_cookie).then(|| token.token.clone()),
    };
    let mut res = Json(body).into_response();
    if session.via_cookie {
        res.headers_mut()
            .append(header::SET_COOKIE, sessions::cookie::set(&state.config, &token.token));
    }
    Ok(res)
}

fn cleared(state: &AppState) -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, sessions::cookie::clear(&state.config));
    res
}

/// Always succeeds, so a client can use it to reset local state even with a dead session.
#[utoipa::path(post, path = "/api/v1/auth/logout", tag = "auth", responses((status = 204)))]
pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    service::logout(&state, &headers).await?;
    Ok(cleared(&state))
}

#[utoipa::path(post, path = "/api/v1/auth/logout-all", tag = "auth", request_body = AuthKeyProof,
    responses((status = 204), (status = 401), (status = 429)))]
pub async fn logout_all(
    State(state): State<AppState>,
    ip: ClientIp,
    FullSession(session): FullSession,
    ApiJson(req): ApiJson<AuthKeyProof>,
) -> Result<Response, AppError> {
    state.ip_limiter.check(ip.0)?;
    let user = service::require_fresh_proof(&state, &session, &req.auth_key).await?;
    crate::account::service::revoke_everything(&state, user.id).await?;
    Ok(cleared(&state))
}
