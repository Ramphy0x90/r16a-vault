//! The browser extension as a client. It signs in like mobile, with a bearer token in the body,
//! but its requests carry an extension Origin. The CSRF layer accepts any well formed extension
//! origin by default, only the listed ones when `R16A_EXTENSION_ORIGINS` is set, and never
//! together with a session cookie.

mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use common::{Auth, COOKIE, TestApp, User, b64};
use serde_json::{Value, json};
use sqlx::PgPool;

const CHROME: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const FIREFOX: &str = "moz-extension://0f3c3a6e-8a8c-4c4e-9b8f-2d6a1c0e5b7d";

fn app(db: PgPool) -> TestApp {
    TestApp::new(db, &[])
}

/// A request shaped like the extension's background fetch. Every knob a forger could vary is a
/// parameter, so each test states exactly what differs from the real thing.
async fn from_extension(
    app: &TestApp,
    path: &str,
    body: Value,
    origin: &str,
    custom_header: bool,
    cookie: Option<&str>,
) -> common::Resp {
    let mut b = Request::post(path)
        .header(header::ORIGIN, origin)
        .header("sec-fetch-site", "cross-site")
        .header(header::CONTENT_TYPE, "application/json");
    if custom_header {
        b = b.header("x-r16a-request", "1");
    }
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("{COOKIE}={c}"));
    }
    app.send(b.body(Body::from(body.to_string())).unwrap()).await
}

fn login_body(user: &User) -> Value {
    json!({"username": user.username, "authKey": b64(&user.auth_key), "client": "extension"})
}

#[sqlx::test]
async fn signs_in_with_a_bearer_token_and_no_cookie(db: PgPool) {
    let app = app(db);
    let user = User::new("ext-alice", 1);
    let reg = from_extension(
        &app,
        "/api/v1/auth/register",
        user.register_body("extension"),
        CHROME,
        true,
        None,
    )
    .await;
    assert_eq!(reg.status, StatusCode::CREATED, "{:?}", reg.body);
    assert!(reg.body["token"].is_string());
    assert!(reg.cookie_token().is_none(), "the extension never gets a cookie");

    let login = from_extension(&app, "/api/v1/auth/login", login_body(&user), FIREFOX, true, None).await;
    assert_eq!(login.status, StatusCode::OK, "{:?}", login.body);
    assert!(login.cookie_token().is_none());
    let token = login.body["token"].as_str().unwrap().to_owned();

    let unlock = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Bearer(token.clone()),
            Some(json!({"authKey": b64(&user.auth_key)})),
        )
        .await;
    assert_eq!(unlock.status, StatusCode::OK);
    let rotated = unlock.body["token"].as_str().unwrap().to_owned();
    assert_ne!(rotated, token, "unlock rotates the bearer token");
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Bearer(token), None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Bearer(rotated), None).await.status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn csrf_accepts_extension_origins_only_with_header_and_without_cookie(db: PgPool) {
    let app = app(db);
    let user = User::new("ext-bob", 2);
    let cookie = app.register(&user).await;
    let body = login_body(&user);
    let refused = |r: &common::Resp| r.status == StatusCode::FORBIDDEN && r.problem_type().ends_with(":csrf");

    for forged in [
        "https://evil.example",
        "chrome-extension://short",
        "chrome-extension://abcdefghijklmnopabcdefghijklmnoz",
        "moz-extension://not-a-uuid",
        "null",
    ] {
        assert!(
            refused(&from_extension(&app, "/api/v1/auth/login", body.clone(), forged, true, None).await),
            "{forged} is not an extension origin"
        );
    }
    assert!(
        refused(&from_extension(&app, "/api/v1/auth/login", body.clone(), CHROME, false, None).await),
        "the custom header is still required"
    );
    assert!(
        refused(&from_extension(&app, "/api/v1/auth/login", body.clone(), CHROME, true, Some(&cookie)).await),
        "a request with a session cookie never takes the extension path"
    );
    for origin in [CHROME, FIREFOX] {
        let ok = from_extension(&app, "/api/v1/auth/login", body.clone(), origin, true, None).await;
        assert_eq!(ok.status, StatusCode::OK, "{origin} {:?}", ok.body);
    }
}

#[sqlx::test]
async fn configured_list_restricts_extension_origins(db: PgPool) {
    let app = TestApp::new(db, &[("R16A_EXTENSION_ORIGINS", CHROME)]);
    let user = User::new("ext-carol", 3);
    app.register(&user).await;
    let other = from_extension(&app, "/api/v1/auth/login", login_body(&user), FIREFOX, true, None).await;
    assert_eq!(other.status, StatusCode::FORBIDDEN);
    let listed = from_extension(&app, "/api/v1/auth/login", login_body(&user), CHROME, true, None).await;
    assert_eq!(listed.status, StatusCode::OK, "{:?}", listed.body);
}

#[sqlx::test]
async fn session_list_names_the_client(db: PgPool) {
    let app = app(db);
    let user = User::new("ext-dave", 4);
    let cookie = app.register(&user).await;
    let ext = from_extension(&app, "/api/v1/auth/login", login_body(&user), CHROME, true, None).await;
    let token = ext.body["token"].as_str().unwrap().to_owned();

    let list = app
        .call("GET", "/api/v1/me/sessions", &Auth::Cookie(cookie), None)
        .await;
    assert_eq!(list.status, StatusCode::OK);
    let mut clients: Vec<&str> = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["client"].as_str().unwrap())
        .collect();
    clients.sort_unstable();
    assert_eq!(clients, ["extension", "web"]);

    let mine = app.call("GET", "/api/v1/me/sessions", &Auth::Bearer(token), None).await;
    let current: Vec<&Value> = mine
        .body
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["current"] == true)
        .collect();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0]["client"], "extension");
}
