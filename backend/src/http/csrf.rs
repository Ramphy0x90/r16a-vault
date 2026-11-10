//! Cross site request forgery defence for state changing requests.
//!
//! SameSite=Strict on the session cookie is the primary control. This layer adds two
//! independent checks. A custom header forces a CORS preflight for any cross site
//! script, and the server never answers preflights, so such scripts cannot send it.
//! The Origin and Sec-Fetch-Site headers catch plain form posts. Requests that carry
//! a bearer token are exempt because browsers never attach those automatically.
//!
//! The browser extension signs in before it holds a token, and its requests carry its own
//! extension origin. Such a request passes when the origin is a well formed extension origin,
//! the custom header is present, and no session cookie is attached. Without a cookie the
//! request has no ambient authority to forge, and a web page can neither claim an extension
//! origin nor send the custom header cross site. The origin is not proof of which extension
//! is calling, any installed extension or native script can reach the API, so the account's
//! auth key proof stays the only real gate. `R16A_EXTENSION_ORIGINS`, when set, narrows the
//! accepted origins for operators who want that.

use axum::{
    extract::{Request, State},
    http::{Method, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::{config::extension_origin, error::AppError, state::AppState};

pub const CSRF_HEADER: &str = "x-r16a-request";

pub async fn csrf_layer(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if is_safe(req.method()) {
        return next.run(req).await;
    }
    let headers = req.headers();
    let has_bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("Bearer "));
    if !has_bearer {
        let custom_ok = headers.get(CSRF_HEADER).is_some_and(|v| v.as_bytes() == b"1");
        let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
        let cookie = has_session_cookie(headers, state.config.cookie_name());
        let from_extension = origin.and_then(extension_origin).is_some_and(|o| {
            let listed = &state.config.extension_origins;
            listed.is_empty() || listed.contains(&o)
        });
        if from_extension && custom_ok && !cookie {
            return next.run(req).await;
        }
        let origin_ok = match origin {
            Some(o) => {
                o.eq_ignore_ascii_case(&state.config.public_origin)
                    || state.config.extra_origins.iter().any(|e| o.eq_ignore_ascii_case(e))
            }
            // Browsers always send Origin on cross origin unsafe requests, so its absence
            // only happens for native clients, which do not carry the cookie.
            None => !cookie,
        };
        let fetch_site_ok = headers
            .get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_none_or(|v| v == "same-origin" || v == "none");
        if !(custom_ok && origin_ok && fetch_site_ok) {
            return AppError::Forbidden("csrf").into_response();
        }
    }
    next.run(req).await
}

fn is_safe(m: &Method) -> bool {
    matches!(*m, Method::GET | Method::HEAD | Method::OPTIONS)
}

pub fn has_session_cookie(headers: &axum::http::HeaderMap, name: &str) -> bool {
    crate::sessions::cookie::read(headers, name).is_some()
}
