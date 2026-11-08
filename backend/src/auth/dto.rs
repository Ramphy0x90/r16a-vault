//! Request and response bodies for the auth endpoints.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::http::wire::KdfDto;

/// A base64 key proof. Debug output is redacted and the buffer is wiped on drop,
/// so the value cannot end up in logs or linger in freed memory.
#[derive(ToSchema)]
#[schema(value_type = String, format = Byte)]
pub struct SecretB64(zeroize::Zeroizing<String>);

impl<'de> Deserialize<'de> for SecretB64 {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        String::deserialize(d).map(|s| Self(zeroize::Zeroizing::new(s)))
    }
}

impl SecretB64 {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SecretB64 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[redacted]")
    }
}

#[cfg(test)]
impl From<&str> for SecretB64 {
    fn from(s: &str) -> Self {
        Self(zeroize::Zeroizing::new(s.to_owned()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ClientKind {
    #[default]
    Web,
    Mobile,
}

impl ClientKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Mobile => "mobile",
        }
    }

    /// Strict parsing, so a corrupted or unexpected value is an error rather than a default.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "web" => Some(Self::Web),
            "mobile" => Some(Self::Mobile),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreloginRequest {
    pub username: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreloginResponse {
    pub kdf: KdfDto,
    #[schema(format = Byte)]
    pub salt: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterRequest {
    pub username: String,
    pub auth_key: SecretB64,
    pub kdf: KdfDto,
    #[schema(format = Byte)]
    pub salt: String,
    #[schema(format = Byte)]
    pub wrapped_vault_key: String,
    #[serde(default)]
    pub client: ClientKind,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    pub username: String,
    pub auth_key: SecretB64,
    #[serde(default)]
    pub client: ClientKind,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthKeyProof {
    pub auth_key: SecretB64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub id: Uuid,
    pub username: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub user: UserSummary,
    pub kdf: KdfDto,
    #[schema(format = Byte)]
    pub salt: String,
    #[schema(format = Byte)]
    pub wrapped_vault_key: String,
    /// Present only for mobile clients. Web clients receive the token as an HttpOnly cookie.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResponse {
    pub kdf: KdfDto,
    #[schema(format = Byte)]
    pub salt: String,
    #[schema(format = Byte)]
    pub wrapped_vault_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfigResponse {
    pub registration_enabled: bool,
    pub oidc_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oidc_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_url: Option<String>,
}
