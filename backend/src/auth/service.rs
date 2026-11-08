//! Authentication rules. Everything that decides who may do what lives here,
//! handlers only translate HTTP.

use axum::http::HeaderMap;
use zeroize::Zeroizing;

use super::{
    dto::{ClientKind, RegisterRequest, SecretB64},
    throttle, username,
    users::{self, NewUser, UserRow},
};
use crate::{
    config::KdfParams,
    crypto::{self, AUTH_KEY_LEN, KDF_SALT_LEN},
    error::AppError,
    http::wire::{self, KdfDto},
    sessions::{self, IssuedToken, SessionState, service::ValidSession},
    state::AppState,
};

pub struct Prelogin {
    pub kdf: KdfParams,
    pub salt: Vec<u8>,
}

/// Real and unknown usernames follow the same path, one indexed lookup plus one HMAC,
/// so neither timing nor shape reveals whether the account exists.
pub async fn prelogin(state: &AppState, raw_username: &str) -> Result<Prelogin, AppError> {
    let name = username::normalize(raw_username)?;
    let user = users::find_by_username(&state.db, &name).await?;
    let fake = crypto::fake_prelogin_salt(state.prelogin_secret(), &name);
    Ok(match user {
        Some(u) => Prelogin {
            kdf: kdf_of(&u)?,
            salt: u.kdf_salt,
        },
        None => Prelogin {
            kdf: KdfParams::DEFAULT,
            salt: fake.to_vec(),
        },
    })
}

pub fn kdf_of(u: &UserRow) -> Result<KdfParams, AppError> {
    Ok(KdfParams {
        opslimit: u32::try_from(u.kdf_opslimit).map_err(AppError::internal)?,
        memlimit: u64::try_from(u.kdf_memlimit).map_err(AppError::internal)?,
    })
}

fn decode_auth_key(k: &SecretB64) -> Result<Zeroizing<Vec<u8>>, AppError> {
    wire::decode_exact(k.expose(), AUTH_KEY_LEN, "invalid-auth-key").map(Zeroizing::new)
}

/// Validated key material for a new or changed master password.
pub struct NewKeyMaterial {
    pub auth_hash: String,
    pub salt: Vec<u8>,
    pub kdf: KdfParams,
    pub wrapped_vault_key: Vec<u8>,
}

pub async fn prepare_key_material(
    state: &AppState,
    auth_key: &SecretB64,
    kdf: &KdfDto,
    salt: &str,
    wrapped_vault_key: &str,
) -> Result<NewKeyMaterial, AppError> {
    let auth_key = decode_auth_key(auth_key)?;
    let kdf = kdf.validate()?;
    let salt = wire::decode_exact(salt, KDF_SALT_LEN, "invalid-salt")?;
    let wrapped_vault_key = wire::decode_wrapped_vault_key(wrapped_vault_key)?;
    let auth_hash = state.hash_auth_key(auth_key).await?;
    Ok(NewKeyMaterial {
        auth_hash,
        salt,
        kdf,
        wrapped_vault_key,
    })
}

pub struct Authenticated {
    pub user: UserRow,
    pub token: IssuedToken,
}

pub async fn register(state: &AppState, req: &RegisterRequest, headers: &HeaderMap) -> Result<Authenticated, AppError> {
    if !state.config.registration_enabled {
        return Err(AppError::Forbidden("registration-disabled"));
    }
    let name = username::normalize(&req.username)?;
    let km = prepare_key_material(state, &req.auth_key, &req.kdf, &req.salt, &req.wrapped_vault_key).await?;

    let mut tx = state.db.begin().await?;
    // A pending OIDC identity is consumed inside the same transaction as the insert, so it
    // links exactly one account even under concurrent requests.
    let identity = match crate::oidc::service::pending_token(state, headers) {
        Some(token) => Some(
            crate::oidc::repository::take_pending(&mut *tx, &crate::crypto::sha256(token.as_bytes()))
                .await?
                .ok_or(AppError::BadRequest("oidc-pending-invalid"))?,
        ),
        None => None,
    };
    let id = users::insert(
        &mut *tx,
        &NewUser {
            username: &name,
            auth_hash: &km.auth_hash,
            kdf_salt: &km.salt,
            kdf_opslimit: i32::try_from(km.kdf.opslimit).map_err(AppError::internal)?,
            kdf_memlimit: i64::try_from(km.kdf.memlimit).map_err(AppError::internal)?,
            wrapped_vault_key: &km.wrapped_vault_key,
            oidc_issuer: identity.as_ref().map(|i| i.issuer.as_str()),
            oidc_subject: identity.as_ref().map(|i| i.subject.as_str()),
        },
    )
    .await?
    .ok_or(AppError::Conflict("username-taken"))?;
    let token = sessions::service::issue(state, &mut *tx, id, SessionState::Full, headers).await?;
    tx.commit().await?;

    let user = users::find_by_id(&state.db, id)
        .await?
        .ok_or_else(|| AppError::internal("user vanished"))?;
    Ok(Authenticated { user, token })
}

/// The single place where a master password proof is checked. Login, unlock and every
/// sensitive operation go through it so they share one throttle per account.
pub async fn verify_proof(
    state: &AppState,
    username_norm: &str,
    user: Option<&UserRow>,
    auth_key: &SecretB64,
) -> Result<(), AppError> {
    let key = crypto::throttle_key(state.prelogin_secret(), username_norm);
    throttle::check(&state.db, &key).await?;

    // A malformed key still costs one Argon2 run, so input shape does not shorten timing.
    let (decoded, well_formed) = match decode_auth_key(auth_key) {
        Ok(k) => (k, true),
        Err(_) => (Zeroizing::new(vec![0u8; AUTH_KEY_LEN]), false),
    };
    let phc = user.map_or_else(|| state.dummy_hash.as_str().to_owned(), |u| u.auth_hash.clone());
    let matched = state.verify_auth_key(decoded, phc).await?;

    if matched && well_formed && user.is_some() {
        throttle::reset(&state.db, &key).await?;
        Ok(())
    } else {
        throttle::record_failure(&state.db, &key).await?;
        Err(AppError::InvalidCredentials)
    }
}

pub async fn login(
    state: &AppState,
    raw_username: &str,
    auth_key: &SecretB64,
    headers: &HeaderMap,
) -> Result<Authenticated, AppError> {
    // Invalid names cannot belong to an account, so they get the generic failure too.
    let name = username::normalize(raw_username).map_err(|_| AppError::InvalidCredentials)?;
    let user = users::find_by_username(&state.db, &name).await?;
    verify_proof(state, &name, user.as_ref(), auth_key).await?;
    let user = user.ok_or(AppError::InvalidCredentials)?;

    if crypto::needs_rehash(&user.auth_hash) {
        let fresh = state.hash_auth_key(decode_auth_key(auth_key)?).await?;
        users::update_auth_hash(&state.db, user.id, &fresh).await?;
    }
    let token = sessions::service::issue(state, &state.db, user.id, SessionState::Full, headers).await?;
    Ok(Authenticated { user, token })
}

/// Checks the proof for the session's own user, then rotates the token and upgrades a
/// pre auth session to full.
pub async fn unlock(
    state: &AppState,
    session: &ValidSession,
    auth_key: &SecretB64,
) -> Result<(UserRow, IssuedToken), AppError> {
    let user = users::find_by_id(&state.db, session.user_id)
        .await?
        .ok_or(AppError::Unauthenticated)?;
    verify_proof(state, &user.username, Some(&user), auth_key).await?;
    let token = sessions::service::rotate(state, session, SessionState::Full).await?;
    Ok((user, token))
}

/// Loads the session owner and checks a fresh proof, for sensitive account operations.
pub async fn require_fresh_proof(
    state: &AppState,
    session: &ValidSession,
    auth_key: &SecretB64,
) -> Result<UserRow, AppError> {
    let user = users::find_by_id(&state.db, session.user_id)
        .await?
        .ok_or(AppError::Unauthenticated)?;
    verify_proof(state, &user.username, Some(&user), auth_key).await?;
    Ok(user)
}

pub fn token_for_body(client: ClientKind, token: &IssuedToken) -> Option<String> {
    (client == ClientKind::Mobile).then(|| token.token.clone())
}
