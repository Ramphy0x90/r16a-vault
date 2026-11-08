//! Assigns every request a random id that ties log lines to problem responses.

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};

#[derive(Debug, Clone)]
pub struct RequestId(pub String);

/// Always generates a fresh id. Ids supplied by clients are ignored so log lines
/// cannot be spoofed or correlated across users by a caller.
pub async fn request_id_layer(mut req: Request, next: Next) -> Response {
    let id = match crate::crypto::random_bytes::<12>() {
        Ok(bytes) => bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        Err(_) => String::from("unavailable"),
    };
    req.extensions_mut().insert(RequestId(id.clone()));
    let span = tracing::info_span!("request", request_id = %id);
    let mut res = tracing::Instrument::instrument(next.run(req), span).await;
    if let Ok(v) = HeaderValue::from_str(&id) {
        res.headers_mut().insert("x-request-id", v);
    }
    res
}
