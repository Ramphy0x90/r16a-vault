//! Server side cryptographic helpers.
//!
//! None of this touches vault data. The server only hashes the client `auth_key`,
//! derives deterministic fake prelogin salts, hashes session tokens, and draws random bytes.
//! All primitives come from audited RustCrypto crates.

use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::AppError;

pub const AUTH_KEY_LEN: usize = 32;
pub const KDF_SALT_LEN: usize = 16;
pub const TOKEN_LEN: usize = 32;

/// Fills a fixed size array from the operating system CSPRNG.
pub fn random_bytes<const N: usize>() -> Result<[u8; N], AppError> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| AppError::internal(format!("os rng failure {e}")))?;
    Ok(buf)
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// HMAC with a domain label prepended so one server secret can serve several purposes
/// without the outputs of one purpose being usable for another.
pub fn hmac_sha256(key: &[u8], label: &str, data: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(label.as_bytes());
    mac.update(&[0]);
    mac.update(data);
    mac.finalize().into_bytes().into()
}

/// Deterministic salt for unknown usernames, so repeated prelogins for the same
/// nonexistent name return a stable value just like a real account would.
pub fn fake_prelogin_salt(secret: &[u8], username_norm: &str) -> [u8; KDF_SALT_LEN] {
    let full = hmac_sha256(secret, "r16a:prelogin-salt", username_norm.as_bytes());
    let mut out = [0u8; KDF_SALT_LEN];
    out.copy_from_slice(&full[..KDF_SALT_LEN]);
    out
}

/// Server Argon2id cost. The input is a uniformly random 256 bit key rather than a
/// human password, so these OWASP minimum values are enough and keep login cheap
/// to defend against floods.
fn server_params() -> Params {
    Params::DEFAULT
}

fn hasher(pepper: Option<&[u8]>) -> Result<Argon2<'_>, AppError> {
    match pepper {
        Some(p) => {
            Argon2::new_with_secret(p, Algorithm::Argon2id, Version::V0x13, server_params()).map_err(AppError::internal)
        }
        None => Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, server_params())),
    }
}

/// Produces a PHC string. CPU heavy, so callers run it on the blocking pool.
pub fn hash_auth_key(auth_key: &[u8], pepper: Option<&[u8]>) -> Result<String, AppError> {
    let salt: Zeroizing<[u8; 16]> = Zeroizing::new(random_bytes()?);
    let hash = hasher(pepper)?
        .hash_password_with_salt(auth_key, salt.as_slice())
        .map_err(AppError::internal)?;
    Ok(hash.to_string())
}

/// Returns whether the key matches. The comparison inside the argon2 crate is constant time.
pub fn verify_auth_key(auth_key: &[u8], phc: &str, pepper: Option<&[u8]>) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(phc).map_err(AppError::internal)?;
    match hasher(pepper)?.verify_password(auth_key, &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::PasswordInvalid) => Ok(false),
        Err(e) => Err(AppError::internal(e)),
    }
}

/// True when a stored hash was made with weaker parameters than the current ones,
/// so it gets transparently upgraded after the next successful login.
pub fn needs_rehash(phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else {
        return true;
    };
    let Ok(stored) = Params::try_from(&parsed) else {
        return true;
    };
    let current = server_params();
    parsed.algorithm.as_str() != "argon2id" || stored.m_cost() < current.m_cost() || stored.t_cost() < current.t_cost()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_roundtrip_with_and_without_pepper() {
        let key = [7u8; 32];
        for pepper in [None, Some(b"0123456789abcdef0123456789abcdef".as_slice())] {
            let phc = hash_auth_key(&key, pepper).unwrap();
            assert!(phc.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
            assert!(verify_auth_key(&key, &phc, pepper).unwrap());
            assert!(!verify_auth_key(&[8u8; 32], &phc, pepper).unwrap());
            assert!(!needs_rehash(&phc));
        }
    }

    #[test]
    fn pepper_is_bound() {
        let key = [1u8; 32];
        let phc = hash_auth_key(&key, Some(b"pepper-one-pepper-one-pepper-one")).unwrap();
        assert!(!verify_auth_key(&key, &phc, Some(b"pepper-two-pepper-two-pepper-two")).unwrap());
        assert!(!verify_auth_key(&key, &phc, None).unwrap());
    }

    #[test]
    fn fake_salt_is_stable_and_secret_dependent() {
        let a = fake_prelogin_salt(b"secret-a", "alice");
        assert_eq!(a, fake_prelogin_salt(b"secret-a", "alice"));
        assert_ne!(a, fake_prelogin_salt(b"secret-b", "alice"));
        assert_ne!(a, fake_prelogin_salt(b"secret-a", "bob"));
    }

    #[test]
    fn labels_separate_purposes() {
        assert_ne!(
            hmac_sha256(b"k", "r16a:throttle:account", b"alice")[..16],
            fake_prelogin_salt(b"k", "alice")[..]
        );
    }
}
