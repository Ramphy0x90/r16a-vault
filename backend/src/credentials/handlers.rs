//! HTTP handlers for `/api/v1/credentials`.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use uuid::Uuid;

use super::{
    dto::{CreateCredentialRequest, CredentialDto},
    service,
};
use crate::{error::AppError, http::json::ApiJson, sessions::FullSession, state::AppState};

#[utoipa::path(get, path = "/api/v1/credentials", tag = "credentials",
    responses((status = 200, body = [CredentialDto]), (status = 401), (status = 403)))]
pub async fn list(
    State(state): State<AppState>,
    FullSession(s): FullSession,
) -> Result<Json<Vec<CredentialDto>>, AppError> {
    Ok(Json(service::list(&state, s.user_id).await?))
}

#[utoipa::path(post, path = "/api/v1/credentials", tag = "credentials", request_body = CreateCredentialRequest,
    responses((status = 201, body = CredentialDto), (status = 400), (status = 409), (status = 413)))]
pub async fn create(
    State(state): State<AppState>,
    FullSession(s): FullSession,
    ApiJson(req): ApiJson<CreateCredentialRequest>,
) -> Result<(StatusCode, Json<CredentialDto>), AppError> {
    Ok((
        StatusCode::CREATED,
        Json(service::create(&state, s.user_id, &req).await?),
    ))
}

#[utoipa::path(delete, path = "/api/v1/credentials/{id}", tag = "credentials",
    params(("id" = Uuid, Path)), responses((status = 204), (status = 404)))]
pub async fn delete(
    State(state): State<AppState>,
    FullSession(s): FullSession,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    // A malformed id cannot exist, so it is reported as not found rather than leaking parser detail.
    let id = Uuid::parse_str(&id).map_err(|_| AppError::NotFound)?;
    service::delete(&state, s.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
