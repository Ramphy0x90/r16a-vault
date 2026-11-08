//! HTTP handlers for `/api/v1/me`.

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

use uuid::Uuid;

use super::{
    dto::{ChangePasswordRequest, MeResponse, SessionDto},
    service,
};
use crate::{
    auth::dto::AuthKeyProof,
    error::AppError,
    http::{client_ip::ClientIp, json::ApiJson},
    sessions::{AnySession, FullSession, cookie},
    state::AppState,
};

#[utoipa::path(get, path = "/api/v1/me", tag = "account", responses((status = 200, body = MeResponse), (status = 401)))]
pub async fn me(State(state): State<AppState>, AnySession(session): AnySession) -> Result<Json<MeResponse>, AppError> {
    Ok(Json(service::profile(&state, &session).await?))
}

#[utoipa::path(put, path = "/api/v1/me/master-password", tag = "account", request_body = ChangePasswordRequest,
    responses((status = 204), (status = 400), (status = 401), (status = 429)))]
pub async fn change_master_password(
    State(state): State<AppState>,
    ip: ClientIp,
    FullSession(session): FullSession,
    ApiJson(req): ApiJson<ChangePasswordRequest>,
) -> Result<StatusCode, AppError> {
    state.ip_limiter.check(ip.0)?;
    service::change_master_password(&state, &session, &req).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/v1/me", tag = "account", request_body = AuthKeyProof,
    responses((status = 204), (status = 401), (status = 429)))]
pub async fn delete_me(
    State(state): State<AppState>,
    ip: ClientIp,
    FullSession(session): FullSession,
    ApiJson(req): ApiJson<AuthKeyProof>,
) -> Result<Response, AppError> {
    state.ip_limiter.check(ip.0)?;
    service::delete_account(&state, &session, &req.auth_key).await?;
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, cookie::clear(&state.config));
    Ok(res)
}

#[utoipa::path(get, path = "/api/v1/me/sessions", tag = "account",
    responses((status = 200, body = [SessionDto]), (status = 401), (status = 403)))]
pub async fn sessions(
    State(state): State<AppState>,
    FullSession(session): FullSession,
) -> Result<Json<Vec<SessionDto>>, AppError> {
    Ok(Json(service::sessions(&state, &session).await?))
}

#[utoipa::path(delete, path = "/api/v1/me/sessions/{id}", tag = "account",
    params(("id" = Uuid, Path)), responses((status = 204), (status = 400), (status = 404)))]
pub async fn revoke_session(
    State(state): State<AppState>,
    FullSession(session): FullSession,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    // A malformed id cannot exist, so it is reported as not found.
    let id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;
    service::revoke_session(&state, &session, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
