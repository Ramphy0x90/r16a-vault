//! HTTP handlers for `/api/v1/auth/oidc`.

use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{
    cookies,
    service::{self, ClientKind, Outcome},
};
use crate::{
    error::AppError,
    http::{client_ip::ClientIp, json::ApiJson},
    sessions,
    state::AppState,
};

#[derive(Debug, Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
pub struct StartQuery {
    /// `web`, `mobile` or `extension`.
    client: Option<String>,
    /// S256 challenge of a verifier held by the mobile app or the extension.
    challenge: Option<String>,
    /// The extension's `identity.getRedirectURL()`, which must be listed in
    /// `R16A_OIDC_EXTENSION_REDIRECTS`. Refused for the other clients.
    redirect: Option<String>,
}

#[utoipa::path(get, path = "/api/v1/auth/oidc/start", tag = "oidc", params(StartQuery),
    responses((status = 302), (status = 404)))]
pub async fn start(
    State(state): State<AppState>,
    ip: ClientIp,
    Query(q): Query<StartQuery>,
) -> Result<Response, AppError> {
    state.prelogin_limiter.check(ip.0)?;
    let client = match q.client.as_deref() {
        None => ClientKind::Web,
        Some(c) => ClientKind::parse(c).ok_or(AppError::BadRequest("invalid-client"))?,
    };
    let started = service::start(&state, client, q.challenge.as_deref(), q.redirect.as_deref()).await?;
    let mut res = Redirect::to(&started.redirect).into_response();
    if let Some(c) = started.browser_cookie {
        res.headers_mut()
            .append(header::SET_COOKIE, cookies::set_flow(&state.config, &c));
    }
    Ok(res)
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Always redirects, either into the app or back to a page that explains the failure.
#[utoipa::path(get, path = "/api/v1/auth/oidc/callback", tag = "oidc", params(CallbackQuery), responses((status = 303)))]
pub async fn callback(
    State(state): State<AppState>,
    ip: ClientIp,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Result<Response, AppError> {
    state.prelogin_limiter.check(ip.0)?;
    let public = state.config.public_url.clone();
    let web_error = |slug: &str| Redirect::to(&format!("{public}/login?oidc_error={slug}")).into_response();
    let (Some(code), Some(st)) = (q.code, q.state) else {
        let slug = if q.error.is_some() {
            "oidc-denied"
        } else {
            "oidc-failed"
        };
        return Ok(with_flow_cleared(&state, web_error(slug)));
    };
    let result = match service::callback(&state, &code, &st, &headers).await {
        Ok(r) => r,
        Err(AppError::BadRequest(slug)) => return Ok(with_flow_cleared(&state, web_error(slug))),
        Err(e) => return Err(e),
    };
    let mobile = state
        .config
        .oidc
        .as_ref()
        .map(|o| o.mobile_redirect.clone())
        .unwrap_or_default();
    // An extension redirect was checked against the allowlist when the flow started. It is
    // checked again here, so removing it from the config also stops flows already running.
    let extension = result.app_redirect.filter(|r| {
        state
            .config
            .oidc
            .as_ref()
            .is_some_and(|o| o.extension_redirects.contains(r))
    });
    let app = match result.client {
        ClientKind::Mobile => Some(mobile),
        ClientKind::Extension => extension,
        ClientKind::Web => None,
    };
    let res = match (app, result.outcome) {
        (Some(app), Ok(Outcome::App { code })) => Redirect::to(&format!("{app}?code={code}")).into_response(),
        (Some(app), Err(slug)) => Redirect::to(&format!("{app}?error={slug}")).into_response(),
        (_, Ok(Outcome::WebPreAuth { session_token })) => {
            let mut r = Redirect::to(&format!("{public}/unlock")).into_response();
            r.headers_mut()
                .append(header::SET_COOKIE, sessions::cookie::set(&state.config, &session_token));
            r
        }
        (_, Ok(Outcome::WebPending { pending_token })) => {
            let mut r = Redirect::to(&format!("{public}/register?oidc=1")).into_response();
            r.headers_mut()
                .append(header::SET_COOKIE, cookies::set_pending(&state.config, &pending_token));
            r
        }
        (_, Ok(Outcome::App { .. })) => web_error("oidc-failed"),
        (_, Err(slug)) => web_error(slug),
    };
    Ok(with_flow_cleared(&state, res))
}

fn with_flow_cleared(state: &AppState, mut res: Response) -> Response {
    res.headers_mut()
        .append(header::SET_COOKIE, cookies::clear_flow(&state.config));
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExchangeRequest {
    code: String,
    verifier: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeResponse {
    token: String,
    /// `pre_auth` when an account exists, `pending` when the app must finish registration.
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested_username: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/auth/oidc/exchange", tag = "oidc", request_body = ExchangeRequest,
    responses((status = 200, body = ExchangeResponse), (status = 400)))]
pub async fn exchange(
    State(state): State<AppState>,
    ip: ClientIp,
    ApiJson(req): ApiJson<ExchangeRequest>,
) -> Result<Json<ExchangeResponse>, AppError> {
    state.ip_limiter.check(ip.0)?;
    let ex = service::exchange(&state, &req.code, &req.verifier).await?;
    Ok(Json(ExchangeResponse {
        token: ex.token,
        state: if ex.pending { "pending" } else { "pre_auth" },
        suggested_username: ex.suggested_username,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested_username: Option<String>,
}

/// Lets the register page show that it is completing an OIDC sign in.
#[utoipa::path(get, path = "/api/v1/auth/oidc/pending", tag = "oidc",
    responses((status = 200, body = PendingResponse), (status = 404)))]
pub async fn pending(State(state): State<AppState>, ip: ClientIp, headers: HeaderMap) -> Result<Response, AppError> {
    state.prelogin_limiter.check(ip.0)?;
    let suggested_username = service::pending(&state, &headers).await?.ok_or(AppError::NotFound)?;
    Ok((StatusCode::OK, Json(PendingResponse { suggested_username })).into_response())
}
