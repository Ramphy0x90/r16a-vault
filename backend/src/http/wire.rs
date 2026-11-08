//! Decoding and validation of binary fields carried as base64 in JSON.
//!
//! The server never inspects ciphertext. It only checks the envelope so that malformed
//! or oversized blobs are rejected before they reach the database.

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{config::KdfParams, error::AppError};

pub const BLOB_VERSION: u8 = 0x01;
pub const NONCE_LEN: usize = 24;
pub const TAG_LEN: usize = 16;
pub const BLOB_MIN_LEN: usize = 1 + NONCE_LEN + TAG_LEN;
pub const BLOB_MAX_LEN: usize = 8192;
/// version, nonce, 32 byte vault key and tag.
pub const WRAPPED_VAULT_KEY_LEN: usize = BLOB_MIN_LEN + 32;

pub fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// Decodes base64 and enforces an exact length. The encoded length is checked first so
/// a huge string is never decoded.
pub fn decode_exact(s: &str, len: usize, slug: &'static str) -> Result<Vec<u8>, AppError> {
    if s.len() > len.div_ceil(3) * 4 {
        return Err(AppError::BadRequest(slug));
    }
    let out = STANDARD.decode(s).map_err(|_| AppError::BadRequest(slug))?;
    if out.len() != len {
        return Err(AppError::BadRequest(slug));
    }
    Ok(out)
}

/// Validates the sealed blob envelope described in SPEC section 3.4.
pub fn decode_blob(s: &str, slug: &'static str) -> Result<Vec<u8>, AppError> {
    if s.len() > BLOB_MAX_LEN.div_ceil(3) * 4 {
        return Err(AppError::PayloadTooLarge("blob-too-large"));
    }
    let out = STANDARD.decode(s).map_err(|_| AppError::BadRequest(slug))?;
    if out.len() < BLOB_MIN_LEN || out.first() != Some(&BLOB_VERSION) {
        return Err(AppError::BadRequest(slug));
    }
    if out.len() > BLOB_MAX_LEN {
        return Err(AppError::PayloadTooLarge("blob-too-large"));
    }
    Ok(out)
}

pub fn decode_wrapped_vault_key(s: &str) -> Result<Vec<u8>, AppError> {
    let out = decode_exact(s, WRAPPED_VAULT_KEY_LEN, "invalid-wrapped-vault-key")?;
    if out[0] != BLOB_VERSION {
        return Err(AppError::BadRequest("invalid-wrapped-vault-key"));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KdfDto {
    /// Always `argon2id13`.
    pub alg: String,
    pub opslimit: u32,
    pub memlimit: u64,
}

impl KdfDto {
    pub fn from_params(p: KdfParams) -> Self {
        Self {
            alg: String::from("argon2id13"),
            opslimit: p.opslimit,
            memlimit: p.memlimit,
        }
    }

    pub fn validate(&self) -> Result<KdfParams, AppError> {
        let p = KdfParams {
            opslimit: self.opslimit,
            memlimit: self.memlimit,
        };
        if self.alg != "argon2id13" || !p.is_acceptable() {
            return Err(AppError::BadRequest("invalid-kdf"));
        }
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_rules() {
        let mut ok = vec![BLOB_VERSION];
        ok.extend([0u8; NONCE_LEN + TAG_LEN]);
        assert!(decode_blob(&b64(&ok), "x").is_ok());
        ok[0] = 2;
        assert!(decode_blob(&b64(&ok), "x").is_err());
        assert!(decode_blob(&b64(&[1u8; 10]), "x").is_err());
        assert!(decode_blob(&b64(&vec![1u8; BLOB_MAX_LEN + 1]), "x").is_err());
        assert!(decode_blob("not base64!!", "x").is_err());
    }

    #[test]
    fn exact_length() {
        assert!(decode_exact(&b64(&[0u8; 32]), 32, "x").is_ok());
        assert!(decode_exact(&b64(&[0u8; 31]), 32, "x").is_err());
    }
}
