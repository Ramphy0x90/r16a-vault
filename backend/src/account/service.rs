//! Account level rules. Each sensitive operation demands a fresh master password proof.

use uuid::Uuid;

use super::dto::{ChangePasswordRequest, MeResponse, SessionDto};
use crate::{
    auth::{service as auth, users},
    error::AppError,
    http::wire,
    sessions::{repository as sessions, service::ValidSession},
    state::AppState,
};

/// Swaps the key material and drops every other session in one transaction, so a
/// session opened with the old password cannot outlive the change.
pub async fn change_master_password(
    state: &AppState,
    session: &ValidSession,
    req: &ChangePasswordRequest,
) -> Result<(), AppError> {
    let user = auth::require_fresh_proof(state, session, &req.current_auth_key).await?;
    let km = auth::prepare_key_material(
        state,
        &req.new_auth_key,
        &req.new_kdf,
        &req.new_salt,
        &req.new_wrapped_vault_key,
    )
    .await?;

    let mut tx = state.db.begin().await?;
    users::update_credentials_material(
        &mut *tx,
        user.id,
        &km.auth_hash,
        &km.salt,
        i32::try_from(km.kdf.opslimit).map_err(AppError::internal)?,
        i64::try_from(km.kdf.memlimit).map_err(AppError::internal)?,
        &km.wrapped_vault_key,
    )
    .await?;
    sessions::delete_others_for_user(&mut *tx, user.id, session.id).await?;
    tx.commit().await?;
    Ok(())
}

/// Removes every session of the user, full and pre auth alike. Mobile OIDC exchange codes
/// reference sessions and are removed by the cascade. Pending OIDC identities belong to no
/// account yet, so there is nothing of the user's to remove there.
pub async fn revoke_everything(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    sessions::delete_all_for_user(&state.db, user_id).await?;
    Ok(())
}

/// Deletes the account. Foreign keys cascade to sessions and credentials. Throttle rows are
/// keyed by HMACs that cannot be traced back to the account and expire on their own TTL.
pub async fn delete_account(
    state: &AppState,
    session: &ValidSession,
    proof: &crate::auth::dto::SecretB64,
) -> Result<(), AppError> {
    let user = auth::require_fresh_proof(state, session, proof).await?;
    let mut tx = state.db.begin().await?;
    users::delete(&mut *tx, user.id).await?;
    tx.commit().await?;
    Ok(())
}

/// The signed in user's own profile, as returned by `GET /me`.
pub async fn profile(state: &AppState, session: &ValidSession) -> Result<MeResponse, AppError> {
    let user = users::find_by_id(&state.db, session.user_id)
        .await?
        .ok_or(AppError::Unauthenticated)?;
    Ok(MeResponse {
        id: user.id,
        kdf: wire::KdfDto::from_params(auth::kdf_of(&user)?),
        salt: wire::b64(&user.kdf_salt),
        session_state: session.state.as_str().to_owned(),
        created_at: user.created_at,
        username: user.username,
    })
}

/// Where the account is signed in, so the owner can spot and end sessions they do not recognise.
pub async fn sessions(state: &AppState, session: &ValidSession) -> Result<Vec<SessionDto>, AppError> {
    Ok(sessions::list_for_user(&state.db, session.user_id)
        .await?
        .into_iter()
        .map(|s| SessionDto {
            current: s.id == session.id,
            id: s.id,
            state: s.state,
            user_agent: s.user_agent,
            created_at: s.created_at,
            last_seen_at: s.last_seen_at,
        })
        .collect())
}

/// Ends one other session. The current one is ended with logout instead, which also clears
/// the cookie, so asking for it here is refused.
pub async fn revoke_session(state: &AppState, session: &ValidSession, id: Uuid) -> Result<(), AppError> {
    if id == session.id {
        return Err(AppError::BadRequest("use-logout"));
    }
    if sessions::delete_for_user(&state.db, session.user_id, id).await? {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}
