use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{auth::dto::SecretB64, http::wire::KdfDto};

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub id: Uuid,
    pub username: String,
    pub kdf: KdfDto,
    #[schema(format = Byte)]
    pub salt: String,
    /// `pre_auth` or `full`.
    pub session_state: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePasswordRequest {
    pub current_auth_key: SecretB64,
    pub new_auth_key: SecretB64,
    #[schema(format = Byte)]
    pub new_salt: String,
    pub new_kdf: KdfDto,
    #[schema(format = Byte)]
    pub new_wrapped_vault_key: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: Uuid,
    /// True for the session making this request.
    pub current: bool,
    /// `pre_auth` or `full`.
    pub state: String,
    /// As sent by the device, at most 256 characters. Clients turn it into a readable name.
    pub user_agent: Option<String>,
    /// `web`, `mobile` or `extension`. Null for sessions created before this was recorded.
    pub client: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub last_seen_at: OffsetDateTime,
}
