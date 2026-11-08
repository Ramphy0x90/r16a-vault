//! Account level rules. Each sensitive operation demands a fresh master password proof.

use uuid::Uuid;

use super::dto::ChangePasswordRequest;
use crate::{
    auth::{service as auth, users},
    crypto,
    error::AppError,
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

/// Deletes the account. Foreign keys cascade to sessions and credentials. The throttle
/// row is removed too so nothing derived from the username remains.
pub async fn delete_account(
    state: &AppState,
    session: &ValidSession,
    proof: &crate::auth::dto::SecretB64,
) -> Result<(), AppError> {
    let user = auth::require_fresh_proof(state, session, proof).await?;
    let mut tx = state.db.begin().await?;
    users::delete(&mut *tx, user.id).await?;
    crate::auth::throttle::reset(&mut *tx, &crypto::throttle_key(state.prelogin_secret(), &user.username)).await?;
    tx.commit().await?;
    Ok(())
}
