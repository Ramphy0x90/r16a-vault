//! Application errors and their RFC 9457 problem rendering.
//!
//! Handlers return [`AppError`]. Converting it into a response only attaches a
//! [`Problem`] extension, and the problem middleware renders the body once the
//! request id is known. Internal causes are logged there and never sent to clients.

use std::time::Duration;

use axum::{
    extract::{Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Serialize;

use crate::{http::request_id::RequestId, state::AppState};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("bad request")]
    BadRequest(&'static str),
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("unauthenticated")]
    Unauthenticated,
    #[error("forbidden")]
    Forbidden(&'static str),
    #[error("not found")]
    NotFound,
    #[error("conflict")]
    Conflict(&'static str),
    #[error("payload too large")]
    PayloadTooLarge(&'static str),
    #[error("too many requests")]
    TooManyRequests { retry_after: Duration },
    #[error("internal error")]
    Internal(String),
}

impl AppError {
    pub fn internal(e: impl std::fmt::Display) -> Self {
        Self::Internal(e.to_string())
    }
}

impl AppError {
    /// Panic responses bypass handlers, so they are built here with the same marker.
    pub fn into_response_for_panic(self) -> Response<axum::body::Body> {
        self.into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        // sqlx errors carry SQL text and server messages but never bound parameter values,
        // so they are safe to log.
        Self::Internal(format!("database error {e}"))
    }
}

/// Everything the problem middleware needs to render a response body.
#[derive(Debug, Clone)]
pub struct Problem {
    pub status: StatusCode,
    pub slug: &'static str,
    pub title: &'static str,
    pub internal: Option<String>,
    pub clear_session: bool,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, slug, title) = match &self {
            Self::BadRequest(slug) => (StatusCode::BAD_REQUEST, *slug, "The request was not valid."),
            Self::InvalidCredentials => (
                StatusCode::UNAUTHORIZED,
                "invalid-credentials",
                "The username or master password is incorrect.",
            ),
            Self::Unauthenticated => (
                StatusCode::UNAUTHORIZED,
                "unauthenticated",
                "Your session has ended. Please sign in again.",
            ),
            Self::Forbidden(slug) => (StatusCode::FORBIDDEN, *slug, "This action is not allowed."),
            Self::NotFound => (StatusCode::NOT_FOUND, "not-found", "The item was not found."),
            Self::Conflict(slug) => (StatusCode::CONFLICT, *slug, "The request conflicts with existing data."),
            Self::PayloadTooLarge(slug) => (StatusCode::PAYLOAD_TOO_LARGE, *slug, "The request is too large."),
            Self::TooManyRequests { .. } => (
                StatusCode::TOO_MANY_REQUESTS,
                "too-many-requests",
                "Too many attempts. Please wait and try again.",
            ),
            Self::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "Something went wrong on our side. Please try again.",
            ),
        };
        let clear_session = matches!(self, Self::Unauthenticated);
        let mut res = status.into_response();
        if let Self::TooManyRequests { retry_after } = &self {
            let secs = retry_after.as_secs().max(1);
            if let Ok(v) = HeaderValue::from_str(&secs.to_string()) {
                res.headers_mut().insert(header::RETRY_AFTER, v);
            }
        }
        res.extensions_mut().insert(Problem {
            status,
            slug,
            title,
            internal: match self {
                Self::Internal(msg) => Some(msg),
                _ => None,
            },
            clear_session,
        });
        res
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProblemBody<'a> {
    #[serde(rename = "type")]
    kind: String,
    title: &'a str,
    status: u16,
    request_id: &'a str,
}

/// Renders [`Problem`] extensions and turns bare framework errors (unknown route,
/// wrong method, oversized body, timeout) into the same problem shape.
pub async fn problem_layer(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let request_id = req
        .extensions()
        .get::<RequestId>()
        .map(|r| r.0.clone())
        .unwrap_or_default();
    let mut res = next.run(req).await;

    let problem = match res.extensions_mut().remove::<Problem>() {
        Some(p) => p,
        None => match res.status() {
            s if s.is_success() || s.is_redirection() || s.is_informational() => return res,
            _ if res
                .headers()
                .get(header::CONTENT_TYPE)
                .is_some_and(|v| v.as_bytes().starts_with(b"application/problem+json")) =>
            {
                return res;
            }
            StatusCode::NOT_FOUND => fallback(StatusCode::NOT_FOUND, "not-found", "The item was not found."),
            StatusCode::METHOD_NOT_ALLOWED => fallback(
                StatusCode::METHOD_NOT_ALLOWED,
                "method-not-allowed",
                "This method is not allowed.",
            ),
            StatusCode::PAYLOAD_TOO_LARGE => fallback(
                StatusCode::PAYLOAD_TOO_LARGE,
                "payload-too-large",
                "The request is too large.",
            ),
            StatusCode::REQUEST_TIMEOUT => {
                fallback(StatusCode::REQUEST_TIMEOUT, "timeout", "The request took too long.")
            }
            s => fallback(s, "error", "The request could not be completed."),
        },
    };

    if let Some(internal) = &problem.internal {
        tracing::error!(request_id = %request_id, error = %internal, "request failed");
    }

    let body = ProblemBody {
        kind: format!("urn:r16a:problem:{}", problem.slug),
        title: problem.title,
        status: problem.status.as_u16(),
        request_id: &request_id,
    };
    // The original headers are kept, because inner layers already attached the security
    // headers, cookies and Retry-After. Only the body and its framing are replaced.
    let (mut parts, _) = res.into_parts();
    let json = serde_json::to_vec(&body).unwrap_or_default();
    parts.status = problem.status;
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.remove(header::CONTENT_ENCODING);
    parts.headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/problem+json"),
    );
    if problem.clear_session {
        parts
            .headers
            .append(header::SET_COOKIE, crate::sessions::cookie::clear(&state.config));
    }
    Response::from_parts(parts, axum::body::Body::from(json))
}

fn fallback(status: StatusCode, slug: &'static str, title: &'static str) -> Problem {
    Problem {
        status,
        slug,
        title,
        internal: None,
        clear_session: false,
    }
}
