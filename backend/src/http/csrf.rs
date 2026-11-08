//! Cross site request forgery defence for state changing requests.
//!
//! SameSite=Strict on the session cookie is the primary control. This layer adds two
//! independent checks. A custom header forces a CORS preflight for any cross site
//! script, and the server never answers preflights, so such scripts cannot send it.
//! The Origin and Sec-Fetch-Site headers catch plain form posts. Requests that carry
//! a bearer token are exempt because browsers never attach those automatically.

use axum::{
    extract::{Request, State},
    http::{Method, header},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::{error::AppError, state::AppState};

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
        let origin_ok = match origin {
            Some(o) => {
                o.eq_ignore_ascii_case(&state.config.public_origin)
                    || state.config.extra_origins.iter().any(|e| o.eq_ignore_ascii_case(e))
            }
            // Browsers always send Origin on cross origin unsafe requests, so its absence
            // only happens for native clients, which do not carry the cookie.
            None => !has_session_cookie(headers, state.config.cookie_name()),
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
