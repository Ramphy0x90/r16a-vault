//! OIDC flows against an in process identity provider that issues real RS256 ID tokens, so
//! state, nonce, PKCE, issuer, audience and signature checks all run for real.

mod common;

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    Form, Json, Router,
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::{Auth, ORIGIN, TestApp, User, b64};
use openidconnect::{
    AccessToken, Audience, EmptyAdditionalClaims, EmptyExtraTokenFields, EndUserUsername, IssuerUrl, JsonWebKeyId,
    Nonce, PrivateSigningKey, StandardClaims, SubjectIdentifier,
    core::{
        CoreIdToken, CoreIdTokenClaims, CoreIdTokenFields, CoreJsonWebKeySet, CoreJwsSigningAlgorithm,
        CoreRsaPrivateSigningKey, CoreTokenResponse, CoreTokenType,
    },
    url::Url,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

const CLIENT_ID: &str = "r16a-vault";
const KEY_PEM: &str = include_str!("fixtures/oidc_test_key.pem");

/// What the fake provider should put in the next ID token for a given code.
#[derive(Clone)]
struct Grant {
    subject: String,
    nonce: String,
    challenge: String,
    audience: String,
}

#[derive(Clone)]
struct Idp {
    issuer: String,
    grants: Arc<Mutex<HashMap<String, Grant>>>,
}

async fn discovery(State(idp): State<Idp>) -> Json<serde_json::Value> {
    Json(json!({
        "issuer": idp.issuer,
        "authorization_endpoint": format!("{}/authorize", idp.issuer),
        "token_endpoint": format!("{}/token", idp.issuer),
        "jwks_uri": format!("{}/jwks", idp.issuer),
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }))
}

fn signing_key() -> CoreRsaPrivateSigningKey {
    CoreRsaPrivateSigningKey::from_pem(KEY_PEM, Some(JsonWebKeyId::new("test".into()))).expect("test key")
}

async fn jwks() -> Json<CoreJsonWebKeySet> {
    Json(CoreJsonWebKeySet::new(vec![signing_key().as_verification_key()]))
}

async fn token(
    State(idp): State<Idp>,
    Form(form): Form<HashMap<String, String>>,
) -> Result<Json<CoreTokenResponse>, StatusCode> {
    let code = form.get("code").ok_or(StatusCode::BAD_REQUEST)?;
    let grant = idp.grants.lock().unwrap().remove(code).ok_or(StatusCode::BAD_REQUEST)?;
    let verifier = form.get("code_verifier").ok_or(StatusCode::BAD_REQUEST)?;
    if URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) != grant.challenge {
        return Err(StatusCode::BAD_REQUEST);
    }
    let now = chrono::Utc::now();
    let claims = CoreIdTokenClaims::new(
        IssuerUrl::new(idp.issuer.clone()).unwrap(),
        vec![Audience::new(grant.audience)],
        now + chrono::Duration::minutes(5),
        now,
        StandardClaims::new(SubjectIdentifier::new(grant.subject))
            .set_preferred_username(Some(EndUserUsername::new("Oidc.User".into()))),
        EmptyAdditionalClaims {},
    )
    .set_nonce(Some(Nonce::new(grant.nonce)));
    let id_token = CoreIdToken::new(
        claims,
        &signing_key(),
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        None,
        None,
    )
    .unwrap();
    Ok(Json(CoreTokenResponse::new(
        AccessToken::new("access".into()),
        CoreTokenType::Bearer,
        CoreIdTokenFields::new(Some(id_token), EmptyExtraTokenFields {}),
    )))
}

async fn spawn_idp() -> Idp {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let idp = Idp {
        issuer: format!("http://{addr}"),
        grants: Arc::default(),
    };
    let app = Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/jwks", get(jwks))
        .route("/token", post(token))
        .with_state(idp.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    idp
}

fn app(db: PgPool, idp: &Idp) -> TestApp {
    TestApp::new(
        db,
        &[
            ("R16A_OIDC_ENABLED", "true"),
            ("R16A_OIDC_ISSUER_URL", &idp.issuer),
            ("R16A_OIDC_CLIENT_ID", CLIENT_ID),
            ("R16A_OIDC_CLIENT_SECRET", "test-secret"),
        ],
    )
}

fn query(location: &str) -> HashMap<String, String> {
    Url::parse(location).unwrap().query_pairs().into_owned().collect()
}

fn set_cookie(resp: &common::Resp, name: &str) -> Option<String> {
    resp.headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|v| {
            v.strip_prefix(&format!("{name}="))
                .map(|r| r.split(';').next().unwrap_or("").to_owned())
        })
        .filter(|v| !v.is_empty())
}

struct Started {
    state: String,
    nonce: String,
    challenge: String,
    flow_cookie: Option<String>,
}

async fn start(app: &TestApp, uri: &str) -> Started {
    let r = app.call("GET", uri, &Auth::None, None).await;
    assert_eq!(r.status, StatusCode::SEE_OTHER, "{:?}", r.body);
    let q = query(r.headers.get(header::LOCATION).unwrap().to_str().unwrap());
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["client_id"], CLIENT_ID);
    Started {
        state: q["state"].clone(),
        nonce: q["nonce"].clone(),
        challenge: q["code_challenge"].clone(),
        flow_cookie: set_cookie(&r, "r16a_oidc_flow"),
    }
}

fn grant(idp: &Idp, s: &Started, subject: &str) -> String {
    let code = format!("code-{}", uuid::Uuid::new_v4());
    idp.grants.lock().unwrap().insert(
        code.clone(),
        Grant {
            subject: subject.into(),
            nonce: s.nonce.clone(),
            challenge: s.challenge.clone(),
            audience: CLIENT_ID.into(),
        },
    );
    code
}

async fn callback(app: &TestApp, code: &str, state: &str, cookie: Option<&str>) -> common::Resp {
    let mut b = Request::get(format!("/api/v1/auth/oidc/callback?code={code}&state={state}"));
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, format!("r16a_oidc_flow={c}"));
    }
    app.send(b.body(Body::empty()).unwrap()).await
}

fn location(r: &common::Resp) -> String {
    r.headers.get(header::LOCATION).unwrap().to_str().unwrap().to_owned()
}

#[sqlx::test]
async fn disabled_by_default(db: PgPool) {
    let app = TestApp::new(db, &[]);
    assert_eq!(
        app.call("GET", "/api/v1/auth/oidc/start", &Auth::None, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    let cfg = app.call("GET", "/api/v1/auth/config", &Auth::None, None).await;
    assert_eq!(cfg.body["oidcEnabled"], false);
}

#[sqlx::test]
async fn web_first_sign_in_registers_and_links_identity(db: PgPool) {
    let idp = spawn_idp().await;
    let app = app(db.clone(), &idp);
    assert_eq!(
        app.call("GET", "/api/v1/auth/config", &Auth::None, None).await.body["oidcDisplayName"],
        "Authentik"
    );

    let s = start(&app, "/api/v1/auth/oidc/start?client=web").await;
    let code = grant(&idp, &s, "sub-123");
    let r = callback(&app, &code, &s.state, s.flow_cookie.as_deref()).await;
    assert_eq!(location(&r), format!("{ORIGIN}/register?oidc=1"));
    let pending = set_cookie(&r, "r16a_oidc_pending").expect("pending cookie");

    let peek = app
        .send(
            Request::get("/api/v1/auth/oidc/pending")
                .header(header::COOKIE, format!("r16a_oidc_pending={pending}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(peek.body["suggestedUsername"], "oidc.user");

    let body = User::new("linked", 9).register_body("web").to_string();
    let r = app
        .send(
            Request::post("/api/v1/auth/register")
                .header(header::ORIGIN, ORIGIN)
                .header("x-r16a-request", "1")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, format!("r16a_oidc_pending={pending}"))
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let (iss, sub): (Option<String>, Option<String>) =
        sqlx::query_as("select oidc_issuer, oidc_subject from users where username = 'linked'")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(sub.as_deref(), Some("sub-123"));
    assert!(iss.unwrap().starts_with(&idp.issuer));

    // The pending token is single use.
    let mut again = User::new("second", 10).register_body("web");
    again["username"] = json!("second");
    let r = app
        .send(
            Request::post("/api/v1/auth/register")
                .header(header::ORIGIN, ORIGIN)
                .header("x-r16a-request", "1")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, format!("r16a_oidc_pending={pending}"))
                .body(Body::from(again.to_string()))
                .unwrap(),
        )
        .await;
    assert_eq!(r.problem_type(), "urn:r16a:problem:oidc-pending-invalid");
}

#[sqlx::test]
async fn web_returning_sign_in_needs_master_password_proof(db: PgPool) {
    let idp = spawn_idp().await;
    let app = app(db.clone(), &idp);
    let u = User::new("returning", 11);
    app.register(&u).await;
    sqlx::query("update users set oidc_issuer = $1, oidc_subject = 'sub-r' where username = 'returning'")
        .bind(idp.issuer.clone())
        .execute(&db)
        .await
        .unwrap();

    let s = start(&app, "/api/v1/auth/oidc/start").await;
    let code = grant(&idp, &s, "sub-r");
    let r = callback(&app, &code, &s.state, s.flow_cookie.as_deref()).await;
    assert_eq!(location(&r), format!("{ORIGIN}/unlock"));
    let session = r.cookie_token().expect("pre auth cookie");

    let me = app
        .call("GET", "/api/v1/me", &Auth::Cookie(session.clone()), None)
        .await;
    assert_eq!(me.body["sessionState"], "pre_auth");
    assert!(me.body.get("wrappedVaultKey").is_none());
    let locked = app
        .call("GET", "/api/v1/credentials", &Auth::Cookie(session.clone()), None)
        .await;
    assert_eq!(locked.problem_type(), "urn:r16a:problem:vault-locked");

    let bad = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Cookie(session.clone()),
            Some(json!({"authKey": b64(&[0u8; 32])})),
        )
        .await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);
    let ok = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Cookie(session),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    assert_eq!(ok.status, StatusCode::OK);
    let full = ok.cookie_token().unwrap();
    assert_eq!(
        app.call("GET", "/api/v1/credentials", &Auth::Cookie(full), None)
            .await
            .status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn rejects_missing_browser_binding_replayed_state_bad_nonce_and_audience(db: PgPool) {
    let idp = spawn_idp().await;
    let app = app(db, &idp);

    let s = start(&app, "/api/v1/auth/oidc/start").await;
    let code = grant(&idp, &s, "x");
    let r = callback(&app, &code, &s.state, None).await;
    assert_eq!(location(&r), format!("{ORIGIN}/login?oidc_error=oidc-browser"));
    let r = callback(&app, &code, &s.state, s.flow_cookie.as_deref()).await;
    assert_eq!(
        location(&r),
        format!("{ORIGIN}/login?oidc_error=oidc-state"),
        "state is single use"
    );

    let s = start(&app, "/api/v1/auth/oidc/start").await;
    let code = grant(&idp, &s, "x");
    idp.grants.lock().unwrap().get_mut(&code).unwrap().nonce = "attacker-nonce".into();
    let r = callback(&app, &code, &s.state, s.flow_cookie.as_deref()).await;
    assert_eq!(location(&r), format!("{ORIGIN}/login?oidc_error=oidc-failed"));

    let s = start(&app, "/api/v1/auth/oidc/start").await;
    let code = grant(&idp, &s, "x");
    idp.grants.lock().unwrap().get_mut(&code).unwrap().audience = "some-other-client".into();
    let r = callback(&app, &code, &s.state, s.flow_cookie.as_deref()).await;
    assert_eq!(location(&r), format!("{ORIGIN}/login?oidc_error=oidc-failed"));

    let r = callback(&app, "whatever", "forged-state", s.flow_cookie.as_deref()).await;
    assert_eq!(location(&r), format!("{ORIGIN}/login?oidc_error=oidc-state"));
}

#[sqlx::test]
async fn mobile_code_needs_the_verifier_and_is_single_use(db: PgPool) {
    let idp = spawn_idp().await;
    let app = app(db.clone(), &idp);
    let verifier = URL_SAFE_NO_PAD.encode([7u8; 48]);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    assert_eq!(
        app.call("GET", "/api/v1/auth/oidc/start?client=mobile", &Auth::None, None)
            .await
            .status,
        StatusCode::BAD_REQUEST,
        "mobile flows require a challenge"
    );
    let s = start(
        &app,
        &format!("/api/v1/auth/oidc/start?client=mobile&challenge={challenge}"),
    )
    .await;
    assert!(s.flow_cookie.is_none());
    let code = grant(&idp, &s, "mobile-sub");
    let r = callback(&app, &code, &s.state, None).await;
    let loc = location(&r);
    assert!(loc.starts_with("r16avault://oidc-callback?code="), "{loc}");
    let one_time = query(&loc.replacen("r16avault://oidc-callback", "http://x/", 1))["code"].clone();

    let wrong = app
        .call(
            "POST",
            "/api/v1/auth/oidc/exchange",
            &Auth::None,
            Some(json!({"code": one_time, "verifier": URL_SAFE_NO_PAD.encode([8u8; 48])})),
        )
        .await;
    assert_eq!(wrong.status, StatusCode::BAD_REQUEST);
    let reused = app
        .call(
            "POST",
            "/api/v1/auth/oidc/exchange",
            &Auth::None,
            Some(json!({"code": one_time, "verifier": verifier})),
        )
        .await;
    assert_eq!(
        reused.status,
        StatusCode::BAD_REQUEST,
        "a failed attempt still burns the code"
    );

    let s = start(
        &app,
        &format!("/api/v1/auth/oidc/start?client=mobile&challenge={challenge}"),
    )
    .await;
    let code = grant(&idp, &s, "mobile-sub");
    let loc = location(&callback(&app, &code, &s.state, None).await);
    let one_time = query(&loc.replacen("r16avault://oidc-callback", "http://x/", 1))["code"].clone();
    let ok = app
        .call(
            "POST",
            "/api/v1/auth/oidc/exchange",
            &Auth::None,
            Some(json!({"code": one_time, "verifier": verifier})),
        )
        .await;
    assert_eq!(ok.status, StatusCode::OK);
    assert_eq!(ok.body["state"], "pending");
    let pending = ok.body["token"].as_str().unwrap().to_owned();

    let r = app
        .send(
            Request::post("/api/v1/auth/register")
                .header("x-r16a-request", "1")
                .header("x-r16a-oidc-pending", &pending)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    User::new("mobileoidc", 12).register_body("mobile").to_string(),
                ))
                .unwrap(),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{:?}", r.body);
    let n: i64 = sqlx::query_scalar("select count(*) from users where oidc_subject = 'mobile-sub'")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[sqlx::test]
async fn logout_all_removes_pre_auth_sessions_and_mobile_codes(db: PgPool) {
    let idp = spawn_idp().await;
    let app = app(db.clone(), &idp);
    let u = User::new("cleanup", 13);
    let full = app.register(&u).await;
    sqlx::query("update users set oidc_issuer = $1, oidc_subject = 'sub-c'")
        .bind(idp.issuer.clone())
        .execute(&db)
        .await
        .unwrap();
    let verifier = URL_SAFE_NO_PAD.encode([5u8; 48]);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let s = start(
        &app,
        &format!("/api/v1/auth/oidc/start?client=mobile&challenge={challenge}"),
    )
    .await;
    let code = grant(&idp, &s, "sub-c");
    callback(&app, &code, &s.state, None).await;
    let codes: i64 = sqlx::query_scalar("select count(*) from oidc_exchange_codes")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(codes, 1);

    let r = app
        .call(
            "POST",
            "/api/v1/auth/logout-all",
            &Auth::Cookie(full),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    let sessions: i64 = sqlx::query_scalar("select count(*) from sessions")
        .fetch_one(&db)
        .await
        .unwrap();
    let codes: i64 = sqlx::query_scalar("select count(*) from oidc_exchange_codes")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!((sessions, codes), (0, 0));
}
