//! Router assembly and the middleware stack.

use std::time::Duration;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderName, HeaderValue, StatusCode, header},
    middleware,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use tower::ServiceBuilder;
use tower_http::{
    catch_panic::CatchPanicLayer, limit::RequestBodyLimitLayer, sensitive_headers::SetSensitiveRequestHeadersLayer,
    set_header::SetResponseHeaderLayer, timeout::TimeoutLayer, trace::TraceLayer,
};

use crate::{account, auth, credentials, error, http, oidc, state::AppState};

/// Large enough for two maximum size blobs in base64 plus JSON overhead.
pub const BODY_LIMIT: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub fn router(state: AppState) -> Router {
    router_with(state, Router::new())
}

/// Builds the app with extra routes mounted inside the full middleware stack. Tests use it to
/// prove that failures in handlers, such as panics, still pass through every layer.
pub fn router_with(state: AppState, extra: Router<AppState>) -> Router {
    let api = Router::new()
        .route("/auth/config", get(auth::handlers::auth_config))
        .route("/auth/prelogin", post(auth::handlers::prelogin))
        .route("/auth/register", post(auth::handlers::register))
        .route("/auth/login", post(auth::handlers::login))
        .route("/auth/unlock", post(auth::handlers::unlock))
        .route("/auth/logout", post(auth::handlers::logout))
        .route("/auth/logout-all", post(auth::handlers::logout_all))
        .route("/auth/oidc/start", get(oidc::handlers::start))
        .route("/auth/oidc/callback", get(oidc::handlers::callback))
        .route("/auth/oidc/exchange", post(oidc::handlers::exchange))
        .route("/auth/oidc/pending", get(oidc::handlers::pending))
        .route("/me", get(account::handlers::me).delete(account::handlers::delete_me))
        .route("/me/sessions", get(account::handlers::sessions))
        .route("/me/sessions/{id}", delete(account::handlers::revoke_session))
        .route("/me/master-password", put(account::handlers::change_master_password))
        .route(
            "/credentials",
            get(credentials::handlers::list).post(credentials::handlers::create),
        )
        .route("/credentials/{id}", delete(credentials::handlers::delete));

    let api = if state.config.expose_openapi {
        api.route("/openapi.json", get(|| async { Json(crate::openapi::document()) }))
    } else {
        api
    };

    let api = api.layer(middleware::from_fn_with_state(state.clone(), http::csrf::csrf_layer));

    // Every backend response is API data or a health probe, none of it may be cached.
    let security_headers = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        ));

    Router::new()
        .nest("/api/v1", api)
        .route("/healthz", get(|| async { StatusCode::OK }))
        .route("/readyz", get(readyz))
        .merge(extra)
        .fallback(|| async { StatusCode::NOT_FOUND })
        .layer(
            ServiceBuilder::new()
                .layer(SetSensitiveRequestHeadersLayer::new([
                    header::AUTHORIZATION,
                    header::COOKIE,
                ]))
                .layer(middleware::from_fn(http::request_id::request_id_layer))
                .layer(
                    TraceLayer::new_for_http().make_span_with(|req: &axum::http::Request<_>| {
                        // Paths can contain credential ids, which are not secret, but query
                        // strings are dropped since the API never uses them.
                        tracing::info_span!("http", method = %req.method(), path = %req.uri().path())
                    }),
                )
                .layer(middleware::from_fn_with_state(state.clone(), error::problem_layer))
                .layer(security_headers)
                // Inside the problem and header layers, so a panic still yields a problem
                // document with request id, no-store and the API security headers.
                .layer(CatchPanicLayer::custom(|_| {
                    error::AppError::internal("handler panicked").into_response()
                }))
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::REQUEST_TIMEOUT,
                    REQUEST_TIMEOUT,
                ))
                .layer(DefaultBodyLimit::max(BODY_LIMIT))
                .layer(RequestBodyLimitLayer::new(BODY_LIMIT)),
        )
        .with_state(state)
}

async fn readyz(State(state): State<AppState>) -> StatusCode {
    let probe = crate::sessions::repository::ping(&state.db);
    match tokio::time::timeout(Duration::from_secs(2), probe).await {
        Ok(Ok(_)) => StatusCode::OK,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    }
}
