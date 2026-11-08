//! OpenAPI description generated from the handler annotations.

use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "r16a-vault API",
        version = "1",
        description = "Zero knowledge credential vault. Credential fields are opaque ciphertext produced by the clients."
    ),
    paths(
        crate::auth::handlers::auth_config,
        crate::auth::handlers::prelogin,
        crate::auth::handlers::register,
        crate::auth::handlers::login,
        crate::auth::handlers::unlock,
        crate::auth::handlers::logout,
        crate::auth::handlers::logout_all,
        crate::oidc::handlers::start,
        crate::oidc::handlers::callback,
        crate::oidc::handlers::exchange,
        crate::oidc::handlers::pending,
        crate::account::handlers::me,
        crate::account::handlers::change_master_password,
        crate::account::handlers::delete_me,
        crate::account::handlers::sessions,
        crate::account::handlers::revoke_session,
        crate::credentials::handlers::list,
        crate::credentials::handlers::create,
        crate::credentials::handlers::delete,
    ),
    tags((name = "auth"), (name = "oidc"), (name = "account"), (name = "credentials"))
)]
pub struct ApiDoc;

/// The generated document with crate metadata that does not belong in the API removed.
/// utoipa copies the package license, which is unset here and would render as invalid.
pub fn document() -> utoipa::openapi::OpenApi {
    let mut doc = ApiDoc::openapi();
    doc.info.license = None;
    doc
}
