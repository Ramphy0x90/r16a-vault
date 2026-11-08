//! Credential rules. Envelope validation, per user quota and ownership.

use uuid::Uuid;

use super::{
    dto::{CreateCredentialRequest, CredentialDto},
    repository::{self, CredentialRow},
};
use crate::{error::AppError, http::wire, state::AppState};

/// Bounds storage a single account can consume.
pub const MAX_PER_USER: i64 = 5000;

fn to_dto(r: CredentialRow) -> CredentialDto {
    CredentialDto {
        id: r.id,
        meta: wire::b64(&r.meta_ct),
        secret: wire::b64(&r.secret_ct),
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

pub async fn list(state: &AppState, user_id: Uuid) -> Result<Vec<CredentialDto>, AppError> {
    Ok(repository::list(&state.db, user_id)
        .await?
        .into_iter()
        .map(to_dto)
        .collect())
}

pub async fn create(state: &AppState, user_id: Uuid, req: &CreateCredentialRequest) -> Result<CredentialDto, AppError> {
    let meta = wire::decode_blob(&req.meta, "invalid-meta")?;
    let secret = wire::decode_blob(&req.secret, "invalid-secret")?;
    let mut tx = state.db.begin().await?;
    repository::lock_user_quota(&mut *tx, user_id).await?;
    if repository::count(&mut *tx, user_id).await? >= MAX_PER_USER {
        return Err(AppError::PayloadTooLarge("credential-limit"));
    }
    let row = repository::insert(&mut *tx, req.id, user_id, &meta, &secret)
        .await?
        .ok_or(AppError::Conflict("credential-exists"))?;
    tx.commit().await?;
    Ok(to_dto(row))
}

/// Deleting a row that belongs to someone else looks exactly like deleting a missing row.
pub async fn delete(state: &AppState, user_id: Uuid, id: Uuid) -> Result<(), AppError> {
    if repository::delete(&state.db, id, user_id).await? {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}
