//! Test harness that drives the real router in process against a throwaway database.
#![allow(dead_code)]

use std::{collections::HashMap, net::SocketAddr};

use axum::{
    Router,
    body::Body,
    extract::connect_info::MockConnectInfo,
    http::{Request, StatusCode, header},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use http_body_util::BodyExt;
use r16a_vault_backend::{app, config::Config, state::AppState};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

pub const ORIGIN: &str = "http://localhost:8080";
pub const COOKIE: &str = "r16a_session_dev";

pub fn config(overrides: &[(&str, &str)]) -> Config {
    let mut env: HashMap<String, String> = HashMap::from([
        ("R16A_DATABASE_URL".into(), "postgres://unused".into()),
        ("R16A_PUBLIC_URL".into(), ORIGIN.into()),
        (
            "R16A_PRELOGIN_SECRET".into(),
            "test-prelogin-secret-0123456789abcdef".into(),
        ),
        ("R16A_DEV_INSECURE_COOKIE".into(), "true".into()),
        ("R16A_RATE_LIMIT_BURST".into(), "10000".into()),
        ("R16A_RATE_LIMIT_PERIOD_MS".into(), "1".into()),
    ]);
    for (k, v) in overrides {
        env.insert((*k).into(), (*v).into());
    }
    Config::from_lookup(|k| env.get(k).cloned()).expect("test config is valid")
}

pub struct TestApp {
    pub router: Router,
    pub db: PgPool,
}

pub struct Resp {
    pub status: StatusCode,
    pub headers: axum::http::HeaderMap,
    pub body: Value,
}

impl Resp {
    pub fn cookie_token(&self) -> Option<String> {
        self.headers
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|v| {
                v.strip_prefix(&format!("{COOKIE}="))
                    .map(|r| r.split(';').next().unwrap_or("").to_owned())
            })
            .filter(|t| !t.is_empty())
    }

    pub fn problem_type(&self) -> &str {
        self.body["type"].as_str().unwrap_or("")
    }
}

/// How a request authenticates, mirroring the web and mobile clients.
#[derive(Clone)]
pub enum Auth {
    None,
    Cookie(String),
    Bearer(String),
}

impl TestApp {
    pub fn new(db: PgPool, overrides: &[(&str, &str)]) -> Self {
        let _ = tracing_subscriber::fmt()
            .with_test_writer()
            .with_env_filter("warn")
            .try_init();
        let state = AppState::new(db.clone(), config(overrides)).expect("state");
        let router = app::router(state).layer(MockConnectInfo(SocketAddr::from(([203, 0, 113, 7], 4000))));
        Self { router, db }
    }

    pub async fn call(&self, method: &str, path: &str, auth: &Auth, body: Option<Value>) -> Resp {
        let mut b = Request::builder()
            .method(method)
            .uri(path)
            .header(header::ORIGIN, ORIGIN)
            .header("x-r16a-request", "1");
        match auth {
            Auth::None => {}
            Auth::Cookie(t) => b = b.header(header::COOKIE, format!("{COOKIE}={t}")),
            Auth::Bearer(t) => b = b.header(header::AUTHORIZATION, format!("Bearer {t}")),
        }
        let req = match body {
            Some(v) => b
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(v.to_string()))
                .unwrap(),
            None => b.body(Body::empty()).unwrap(),
        };
        self.send(req).await
    }

    pub async fn send(&self, req: Request<Body>) -> Resp {
        let res = self.router.clone().oneshot(req).await.expect("infallible");
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into()))
        };
        Resp { status, headers, body }
    }

    /// Registers a web user and returns its cookie token.
    pub async fn register(&self, user: &User) -> String {
        let r = self
            .call(
                "POST",
                "/api/v1/auth/register",
                &Auth::None,
                Some(user.register_body("web")),
            )
            .await;
        assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
        r.cookie_token().expect("cookie set")
    }

    pub async fn login(&self, username: &str, auth_key: &[u8; 32]) -> Resp {
        self.call(
            "POST",
            "/api/v1/auth/login",
            &Auth::None,
            Some(json!({"username": username, "authKey": b64(auth_key), "client": "web"})),
        )
        .await
    }
}

pub fn b64(b: &[u8]) -> String {
    STANDARD.encode(b)
}

/// A sealed blob envelope. The contents are random, which is all the server can see anyway.
pub fn blob(len: usize) -> String {
    let mut v = vec![0x01u8];
    v.extend((0..len.saturating_sub(1)).map(|i| (i % 251) as u8));
    b64(&v)
}

pub struct User {
    pub username: String,
    pub auth_key: [u8; 32],
    pub salt: [u8; 16],
}

impl User {
    pub fn new(name: &str, seed: u8) -> Self {
        Self {
            username: name.into(),
            auth_key: [seed; 32],
            salt: [seed.wrapping_add(1); 16],
        }
    }

    pub fn register_body(&self, client: &str) -> Value {
        json!({
            "username": self.username,
            "authKey": b64(&self.auth_key),
            "kdf": {"alg": "argon2id13", "opslimit": 3, "memlimit": 67108864},
            "salt": b64(&self.salt),
            "wrappedVaultKey": blob(73),
            "client": client,
        })
    }
}
