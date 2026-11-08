//! HTTP handlers for `/api/v1/me`.

use axum::{
    Json,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

use super::{
    dto::{ChangePasswordRequest, MeResponse},
    service,
};
use crate::{
    auth::{dto::AuthKeyProof, service as auth, users},
    error::AppError,
    http::{client_ip::ClientIp, json::ApiJson, wire},
    sessions::{AnySession, FullSession, cookie},
    state::AppState,
};

#[utoipa::path(get, path = "/api/v1/me", tag = "account", responses((status = 200, body = MeResponse), (status = 401)))]
pub async fn me(State(state): State<AppState>, AnySession(session): AnySession) -> Result<Json<MeResponse>, AppError> {
    let user = users::find_by_id(&state.db, session.user_id)
        .await?
        .ok_or(AppError::Unauthenticated)?;
    Ok(Json(MeResponse {
        id: user.id,
        kdf: wire::KdfDto::from_params(auth::kdf_of(&user)?),
        salt: wire::b64(&user.kdf_salt),
        session_state: session.state.as_str().to_owned(),
        created_at: user.created_at,
        username: user.username,
    }))
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
