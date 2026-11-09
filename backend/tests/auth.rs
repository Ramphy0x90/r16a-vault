mod common;

use axum::http::{StatusCode, header};
use common::{Auth, TestApp, User, b64, blob};
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test]
async fn register_sets_hardened_cookie_and_hides_token(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("alice", 1);
    let r = app
        .call(
            "POST",
            "/api/v1/auth/register",
            &Auth::None,
            Some(u.register_body("web")),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    let cookie = r.headers.get(header::SET_COOKIE).unwrap().to_str().unwrap();
    assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict") && cookie.contains("Path=/"));
    assert!(r.body.get("token").is_none());
    assert_eq!(r.body["user"]["username"], "alice");
    assert_eq!(r.body["wrappedVaultKey"], blob(73));
    assert_eq!(r.headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
}

#[sqlx::test]
async fn mobile_register_returns_token_in_body_only(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let r = app
        .call(
            "POST",
            "/api/v1/auth/register",
            &Auth::None,
            Some(User::new("bob", 2).register_body("mobile")),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    let token = r.body["token"].as_str().unwrap().to_owned();
    assert!(r.headers.get(header::SET_COOKIE).is_none());
    let me = app.call("GET", "/api/v1/me", &Auth::Bearer(token), None).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.body["sessionState"], "full");
}

#[sqlx::test]
async fn usernames_are_normalised_and_unique(db: PgPool) {
    let app = TestApp::new(db, &[]);
    app.register(&User::new("  Alice ", 1)).await;
    let r = app
        .call(
            "POST",
            "/api/v1/auth/register",
            &Auth::None,
            Some(User::new("ALICE", 3).register_body("web")),
        )
        .await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert_eq!(r.problem_type(), "urn:r16a:problem:username-taken");
}

#[sqlx::test]
async fn register_rejects_weak_kdf_bad_sizes_and_unknown_fields(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("carol", 4);
    let mut weak = u.register_body("web");
    weak["kdf"]["memlimit"] = json!(1024);
    let mut short_key = u.register_body("web");
    short_key["authKey"] = json!(b64(&[1u8; 16]));
    let mut bad_wrap = u.register_body("web");
    bad_wrap["wrappedVaultKey"] = json!(blob(40));
    let mut extra = u.register_body("web");
    extra["isAdmin"] = json!(true);
    for body in [weak, short_key, bad_wrap, extra] {
        let r = app.call("POST", "/api/v1/auth/register", &Auth::None, Some(body)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{:?}", r.body);
        assert_eq!(r.headers.get(header::CONTENT_TYPE).unwrap(), "application/problem+json");
    }
}

#[sqlx::test]
async fn registration_can_be_disabled(db: PgPool) {
    let app = TestApp::new(db, &[("R16A_REGISTRATION_ENABLED", "false")]);
    let r = app
        .call(
            "POST",
            "/api/v1/auth/register",
            &Auth::None,
            Some(User::new("dave", 5).register_body("web")),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let cfg = app.call("GET", "/api/v1/auth/config", &Auth::None, None).await;
    assert_eq!(cfg.body["registrationEnabled"], false);
}

#[sqlx::test]
async fn prelogin_does_not_reveal_existence(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("erin", 6);
    app.register(&u).await;

    let real = app
        .call(
            "POST",
            "/api/v1/auth/prelogin",
            &Auth::None,
            Some(json!({"username": "Erin"})),
        )
        .await;
    assert_eq!(real.status, StatusCode::OK);
    assert_eq!(real.body["salt"], b64(&u.salt));

    let fake1 = app
        .call(
            "POST",
            "/api/v1/auth/prelogin",
            &Auth::None,
            Some(json!({"username": "ghost"})),
        )
        .await;
    let fake2 = app
        .call(
            "POST",
            "/api/v1/auth/prelogin",
            &Auth::None,
            Some(json!({"username": "ghost"})),
        )
        .await;
    assert_eq!(fake1.status, StatusCode::OK);
    assert_eq!(fake1.body, fake2.body, "fake salt must be deterministic");
    assert_eq!(fake1.body["kdf"], real.body["kdf"]);
    let keys = |v: &serde_json::Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    assert_eq!(keys(&fake1.body), keys(&real.body));
    assert_eq!(b64(&[0u8; 16]).len(), fake1.body["salt"].as_str().unwrap().len());
}

#[sqlx::test]
async fn login_failures_are_generic(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("frank", 7);
    app.register(&u).await;

    let wrong = app.login("frank", &[9u8; 32]).await;
    let unknown = app.login("nobody", &[9u8; 32]).await;
    let invalid_name = app.login("x", &[9u8; 32]).await;
    for r in [&wrong, &unknown, &invalid_name] {
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
        assert_eq!(r.problem_type(), "urn:r16a:problem:invalid-credentials");
        assert_eq!(r.body["title"], wrong.body["title"]);
    }

    let ok = app.login("FRANK", &u.auth_key).await;
    assert_eq!(ok.status, StatusCode::OK);
    assert!(ok.cookie_token().is_some());
    assert_eq!(ok.body["salt"], b64(&u.salt));
}

#[sqlx::test]
async fn throttle_backs_off_and_is_keyed_by_hmac(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let u = User::new("grace", 8);
    app.register(&u).await;
    for _ in 0..5 {
        assert_eq!(app.login("grace", &[0u8; 32]).await.status, StatusCode::UNAUTHORIZED);
    }
    let blocked = app.login("grace", &u.auth_key).await;
    assert_eq!(blocked.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(blocked.headers.get(header::RETRY_AFTER).is_some());

    // Unknown names are throttled identically so backoff does not reveal accounts.
    for _ in 0..5 {
        app.login("phantom", &[0u8; 32]).await;
    }
    assert_eq!(
        app.login("phantom", &[0u8; 32]).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );

    let rows: Vec<Vec<u8>> = sqlx::query_scalar("select key_hash from login_throttle")
        .fetch_all(&db)
        .await
        .unwrap();
    // One source bucket and one account bucket for each name.
    assert_eq!(rows.len(), 4);
    assert!(
        rows.iter()
            .all(|k| k.len() == 32 && !k.windows(5).any(|w| w == b"grace"))
    );

    sqlx::query("update login_throttle set next_allowed_at = now() - interval '1 second'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(app.login("grace", &u.auth_key).await.status, StatusCode::OK);
    let left: i64 = sqlx::query_scalar("select count(*) from login_throttle")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(left, 2, "success resets grace's buckets and leaves phantom's");
}

#[sqlx::test]
async fn throttle_rows_expire_on_ttl(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    app.login("someone", &[0u8; 32]).await;
    sqlx::query("update login_throttle set updated_at = now() - interval '2 days'")
        .execute(&db)
        .await
        .unwrap();
    let removed = r16a_vault_backend::auth::throttle::delete_stale(&db, std::time::Duration::from_secs(86_400))
        .await
        .unwrap();
    assert_eq!(removed, 2, "the source and account buckets of the one failed login");
}

#[sqlx::test]
async fn ip_rate_limit_applies(db: PgPool) {
    let app = TestApp::new(
        db,
        &[("R16A_RATE_LIMIT_BURST", "2"), ("R16A_RATE_LIMIT_PERIOD_MS", "60000")],
    );
    // Proof endpoints share the strict bucket.
    for _ in 0..2 {
        assert_eq!(app.login("ivan", &[0u8; 32]).await.status, StatusCode::UNAUTHORIZED);
    }
    let r = app.login("ivan", &[0u8; 32]).await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(r.headers.get(header::RETRY_AFTER).is_some());

    // Prelogin has its own bucket, three times the proof burst.
    let body = json!({"username": "ivan"});
    for _ in 0..6 {
        let r = app
            .call("POST", "/api/v1/auth/prelogin", &Auth::None, Some(body.clone()))
            .await;
        assert_eq!(r.status, StatusCode::OK);
    }
    let r = app.call("POST", "/api/v1/auth/prelogin", &Auth::None, Some(body)).await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
}

#[sqlx::test]
async fn csrf_checks_apply_to_cookie_requests(db: PgPool) {
    use axum::{body::Body, http::Request};
    let app = TestApp::new(db, &[]);
    let token = app.register(&User::new("judy", 10)).await;
    let cookie = format!("{}={token}", common::COOKIE);
    let body = json!({"id": uuid::Uuid::new_v4(), "meta": blob(60), "secret": blob(60)}).to_string();

    let build = |origin: Option<&str>, custom: bool, site: Option<&str>| {
        let mut b = Request::post("/api/v1/credentials")
            .header(header::COOKIE, &cookie)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(o) = origin {
            b = b.header(header::ORIGIN, o);
        }
        if custom {
            b = b.header("x-r16a-request", "1");
        }
        if let Some(s) = site {
            b = b.header("sec-fetch-site", s);
        }
        b.body(Body::from(body.clone())).unwrap()
    };

    for req in [
        build(Some(common::ORIGIN), false, None),
        build(Some("https://evil.example"), true, None),
        build(None, true, None),
        build(Some(common::ORIGIN), true, Some("cross-site")),
    ] {
        let r = app.send(req).await;
        assert_eq!(r.status, StatusCode::FORBIDDEN);
        assert_eq!(r.problem_type(), "urn:r16a:problem:csrf");
    }
    assert_eq!(
        app.send(build(Some(common::ORIGIN), true, Some("same-origin")))
            .await
            .status,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn bearer_requests_skip_csrf(db: PgPool) {
    use axum::{body::Body, http::Request};
    let app = TestApp::new(db, &[]);
    let r = app
        .call(
            "POST",
            "/api/v1/auth/register",
            &Auth::None,
            Some(User::new("kim", 11).register_body("mobile")),
        )
        .await;
    let token = r.body["token"].as_str().unwrap();
    let req = Request::post("/api/v1/credentials")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"id": uuid::Uuid::new_v4(), "meta": blob(60), "secret": blob(60)}).to_string(),
        ))
        .unwrap();
    assert_eq!(app.send(req).await.status, StatusCode::CREATED);
}

#[sqlx::test]
async fn unlock_rotates_token(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("leo", 12);
    let old = app.register(&u).await;

    let bad = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Cookie(old.clone()),
            Some(json!({"authKey": b64(&[0u8; 32])})),
        )
        .await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);

    let r = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Cookie(old.clone()),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["wrappedVaultKey"], blob(73));
    assert!(r.body.get("token").is_none());
    let new = r.cookie_token().expect("rotated cookie");
    assert_ne!(new, old);

    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(old), None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(new), None).await.status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn mobile_unlock_returns_rotated_token_in_body(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("mia", 13);
    let r = app
        .call(
            "POST",
            "/api/v1/auth/register",
            &Auth::None,
            Some(u.register_body("mobile")),
        )
        .await;
    let old = r.body["token"].as_str().unwrap().to_owned();
    let r = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Bearer(old.clone()),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    let new = r.body["token"].as_str().unwrap().to_owned();
    assert_ne!(new, old);
    assert!(r.headers.get(header::SET_COOKIE).is_none());
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Bearer(old), None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn pre_auth_session_is_locked_until_unlock(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let u = User::new("nina", 14);
    let token = app.register(&u).await;
    sqlx::query("update sessions set state = 'pre_auth'")
        .execute(&db)
        .await
        .unwrap();

    let r = app
        .call("GET", "/api/v1/credentials", &Auth::Cookie(token.clone()), None)
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.problem_type(), "urn:r16a:problem:vault-locked");
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(token.clone()), None)
            .await
            .body["sessionState"],
        "pre_auth"
    );

    let r = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Cookie(token),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    let full = r.cookie_token().unwrap();
    assert_eq!(
        app.call("GET", "/api/v1/credentials", &Auth::Cookie(full), None)
            .await
            .status,
        StatusCode::OK
    );
}

#[sqlx::test]
async fn sessions_expire_on_idle_and_absolute_limits(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let a = app.register(&User::new("oscar", 15)).await;
    sqlx::query("update sessions set last_seen_at = now() - interval '31 minutes'")
        .execute(&db)
        .await
        .unwrap();
    let r = app.call("GET", "/api/v1/me", &Auth::Cookie(a), None).await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert!(
        r.headers
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );

    let b = app.login("oscar", &[15u8; 32]).await.cookie_token().unwrap();
    sqlx::query("update sessions set expires_at = now() - interval '1 second'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(b), None).await.status,
        StatusCode::UNAUTHORIZED
    );

    let n: i64 = sqlx::query_scalar("select count(*) from sessions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(n, 0, "expired sessions are deleted on access");
}

#[sqlx::test]
async fn sliding_refresh_updates_last_seen(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let t = app.register(&User::new("pat", 16)).await;
    sqlx::query("update sessions set last_seen_at = now() - interval '5 minutes'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(t), None).await.status,
        StatusCode::OK
    );
    let fresh: bool = sqlx::query_scalar("select last_seen_at > now() - interval '10 seconds' from sessions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(fresh);
}

#[sqlx::test]
async fn cleanup_removes_expired_sessions(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    app.register(&User::new("quinn", 17)).await;
    app.register(&User::new("rita", 18)).await;
    sqlx::query("update sessions set expires_at = now() - interval '1 second' where user_id = (select id from users where username = 'quinn')")
        .execute(&db)
        .await
        .unwrap();
    let removed = r16a_vault_backend::sessions::repository::delete_expired(&db, 1800.0)
        .await
        .unwrap();
    assert_eq!(removed, 1);
}

#[sqlx::test]
async fn logout_and_garbage_tokens(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let t = app.register(&User::new("sam", 19)).await;
    let r = app
        .call("POST", "/api/v1/auth/logout", &Auth::Cookie(t.clone()), None)
        .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(t), None).await.status,
        StatusCode::UNAUTHORIZED
    );
    for junk in ["", "short", &"a".repeat(43), &"!".repeat(43)] {
        let r = app
            .call("GET", "/api/v1/me", &Auth::Bearer(junk.to_owned()), None)
            .await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    }
}

#[sqlx::test]
async fn logout_all_requires_proof_and_kills_every_session(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let u = User::new("tina", 20);
    let a = app.register(&u).await;
    let b = app.login("tina", &u.auth_key).await.cookie_token().unwrap();
    sqlx::query("update sessions set state = 'pre_auth' where token_hash <> (select token_hash from sessions order by created_at limit 1)")
        .execute(&db)
        .await
        .unwrap();

    let r = app
        .call(
            "POST",
            "/api/v1/auth/logout-all",
            &Auth::Cookie(a.clone()),
            Some(json!({"authKey": b64(&[0u8; 32])})),
        )
        .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    let r = app
        .call(
            "POST",
            "/api/v1/auth/logout-all",
            &Auth::Cookie(a.clone()),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    for t in [a, b] {
        assert_eq!(
            app.call("GET", "/api/v1/me", &Auth::Cookie(t), None).await.status,
            StatusCode::UNAUTHORIZED
        );
    }
    let n: i64 = sqlx::query_scalar("select count(*) from sessions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[sqlx::test]
async fn framework_errors_use_problem_json(db: PgPool) {
    use axum::{body::Body, http::Request};
    let app = TestApp::new(db, &[]);
    let r = app.call("GET", "/api/v1/nope", &Auth::None, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    // Problem responses keep the security headers added by inner layers.
    assert_eq!(r.headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(), "nosniff");
    assert_eq!(r.headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
    let unauth = app.call("GET", "/api/v1/me", &Auth::None, None).await;
    assert_eq!(unauth.headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
    assert!(unauth.headers.get(header::CONTENT_SECURITY_POLICY).is_some());
    assert_eq!(r.headers.get(header::CONTENT_TYPE).unwrap(), "application/problem+json");
    assert!(r.body["requestId"].as_str().is_some_and(|s| !s.is_empty()));

    let big = "x".repeat(70 * 1024);
    let req = Request::post("/api/v1/auth/prelogin")
        .header(header::ORIGIN, common::ORIGIN)
        .header("x-r16a-request", "1")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!("{{\"username\":\"{big}\"}}")))
        .unwrap();
    let r = app.send(req).await;
    assert_eq!(r.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(r.headers.get(header::CONTENT_TYPE).unwrap(), "application/problem+json");

    let req = Request::post("/api/v1/auth/prelogin")
        .header(header::ORIGIN, common::ORIGIN)
        .header("x-r16a-request", "1")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{not json"))
        .unwrap();
    let r = app.send(req).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert!(!r.body.to_string().contains("not json"), "input is never echoed");
}

#[sqlx::test]
async fn health_endpoints(db: PgPool) {
    let app = TestApp::new(db, &[]);
    assert_eq!(
        app.call("GET", "/healthz", &Auth::None, None).await.status,
        StatusCode::OK
    );
    assert_eq!(
        app.call("GET", "/readyz", &Auth::None, None).await.status,
        StatusCode::OK
    );
}

/// A stranger who knows only the username must not be able to lock the owner out, neither
/// from signing in elsewhere nor from unlocking a session the owner already holds.
#[sqlx::test]
async fn username_spraying_does_not_lock_out_the_owner(db: PgPool) {
    use axum::{body::Body, http::Request};
    let app = TestApp::new(db, &[("R16A_TRUSTED_PROXY_CIDRS", "203.0.113.7/32")]);
    let u = User::new("victim", 21);
    let session = app.register(&u).await;

    let attempt = |ip: &str, key: [u8; 32]| {
        Request::post("/api/v1/auth/login")
            .header(header::ORIGIN, common::ORIGIN)
            .header("x-r16a-request", "1")
            .header("x-forwarded-for", ip)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({"username": "victim", "authKey": b64(&key), "client": "web"}).to_string(),
            ))
            .unwrap()
    };
    for _ in 0..6 {
        app.send(attempt("198.51.100.66", [0u8; 32])).await;
    }
    assert_eq!(
        app.send(attempt("198.51.100.66", u.auth_key)).await.status,
        StatusCode::TOO_MANY_REQUESTS,
        "the attacker's own network is blocked"
    );
    assert_eq!(
        app.send(attempt("192.0.2.10", u.auth_key)).await.status,
        StatusCode::OK,
        "the owner elsewhere is not"
    );
    let unlock = app
        .call(
            "POST",
            "/api/v1/auth/unlock",
            &Auth::Cookie(session),
            Some(json!({"authKey": b64(&u.auth_key)})),
        )
        .await;
    assert_eq!(unlock.status, StatusCode::OK, "unlocking an existing session is not");
}

/// Claims are atomic, so a burst of parallel attempts cannot all pass while the bucket is open.
#[sqlx::test]
async fn parallel_attempts_cannot_share_one_window(db: PgPool) {
    use r16a_vault_backend::auth::throttle::{Bucket, PER_SOURCE, claim};
    let bucket = Bucket {
        key: [7u8; 32],
        policy: PER_SOURCE,
    };
    let started = std::time::Instant::now();
    let tasks: Vec<_> = (0..30)
        .map(|_| {
            let db = db.clone();
            tokio::spawn(async move { claim(&db, &bucket).await.is_ok() })
        })
        .collect();
    let mut passed = 0;
    for t in tasks {
        if t.await.unwrap() {
            passed += 1;
        }
    }
    // Delays after the free attempts are 1, 2, 4 seconds and so on, so a slow machine where the
    // burst outlasts a window may legitimately let one more attempt through per elapsed window.
    // A broken claim would let most of the 30 through instead.
    let elapsed = started.elapsed().as_secs_f64();
    let reopened = (elapsed + 1.0).log2().floor() as i32;
    let first_window = PER_SOURCE.free + 1;
    assert!(
        (first_window..=first_window + reopened).contains(&passed),
        "{passed} attempts got through in {elapsed:.2}s, expected {first_window} plus at most {reopened}"
    );
}

/// A panicking handler still yields a problem document carrying every security header.
#[sqlx::test]
async fn panics_are_rendered_with_headers(db: PgPool) {
    use axum::{Router, body::Body, extract::connect_info::MockConnectInfo, http::Request, routing::get};
    use r16a_vault_backend::{app, state::AppState};
    use std::net::SocketAddr;
    let state = AppState::new(db.clone(), common::config(&[])).unwrap();
    async fn boom() -> StatusCode {
        let fail = std::hint::black_box(true);
        if fail {
            panic!("boom");
        }
        StatusCode::OK
    }
    let extra = Router::new().route("/boom", get(boom));
    let router = app::router_with(state, extra).layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 1))));
    let app = TestApp { router, db };
    let r = app.send(Request::get("/boom").body(Body::empty()).unwrap()).await;
    assert_eq!(r.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(r.problem_type(), "urn:r16a:problem:internal");
    assert!(r.body["requestId"].as_str().is_some_and(|s| !s.is_empty()));
    assert_eq!(r.headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
    assert!(r.headers.get(header::CONTENT_SECURITY_POLICY).is_some());
}

/// Hashes made with weaker parameters are upgraded transparently on the next login.
#[sqlx::test]
async fn login_rehashes_weak_hashes(db: PgPool) {
    use argon2::{Algorithm, Argon2, Params, Version, password_hash::PasswordHasher};
    let app = TestApp::new(db.clone(), &[]);
    let u = User::new("legacy", 22);
    app.register(&u).await;
    let weak = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(8 * 1024, 1, 1, None).unwrap(),
    )
    .hash_password_with_salt(&u.auth_key, b"legacy-salt-0123")
    .unwrap()
    .to_string();
    sqlx::query("update users set auth_hash = $1 where username = 'legacy'")
        .bind(&weak)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(app.login("legacy", &u.auth_key).await.status, StatusCode::OK);
    let stored: String = sqlx::query_scalar("select auth_hash from users where username = 'legacy'")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(stored.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"), "{stored}");
    assert_eq!(app.login("legacy", &u.auth_key).await.status, StatusCode::OK);
}
