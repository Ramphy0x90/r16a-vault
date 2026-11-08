mod common;

use axum::http::{StatusCode, header};
use common::{Auth, TestApp, User, b64, blob};
use serde_json::json;
use sqlx::PgPool;

fn change_body(current: &[u8; 32], new: &[u8; 32]) -> serde_json::Value {
    json!({
        "currentAuthKey": b64(current),
        "newAuthKey": b64(new),
        "newSalt": b64(&[42u8; 16]),
        "newKdf": {"alg": "argon2id13", "opslimit": 4, "memlimit": 67108864},
        "newWrappedVaultKey": blob(73),
    })
}

#[sqlx::test]
async fn me_returns_profile(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("alice", 1);
    let t = Auth::Cookie(app.register(&u).await);
    let r = app.call("GET", "/api/v1/me", &t, None).await;
    assert_eq!(r.body["username"], "alice");
    assert_eq!(r.body["salt"], b64(&u.salt));
    assert!(
        r.body.get("wrappedVaultKey").is_none(),
        "wrapped key only comes from login and unlock"
    );
}

#[sqlx::test]
async fn change_master_password(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let u = User::new("bob", 2);
    let current = app.register(&u).await;
    let other = app.login("bob", &u.auth_key).await.cookie_token().unwrap();
    let new_key = [77u8; 32];

    let bad = app
        .call(
            "PUT",
            "/api/v1/me/master-password",
            &Auth::Cookie(current.clone()),
            Some(change_body(&[0u8; 32], &new_key)),
        )
        .await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);

    let mut weak = change_body(&u.auth_key, &new_key);
    weak["newKdf"]["opslimit"] = json!(1);
    let r = app
        .call(
            "PUT",
            "/api/v1/me/master-password",
            &Auth::Cookie(current.clone()),
            Some(weak),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let r = app
        .call(
            "PUT",
            "/api/v1/me/master-password",
            &Auth::Cookie(current.clone()),
            Some(change_body(&u.auth_key, &new_key)),
        )
        .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);

    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(current), None).await.status,
        StatusCode::OK
    );
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(other), None).await.status,
        StatusCode::UNAUTHORIZED
    );

    assert_eq!(app.login("bob", &u.auth_key).await.status, StatusCode::UNAUTHORIZED);
    let ok = app.login("bob", &new_key).await;
    assert_eq!(ok.status, StatusCode::OK);
    assert_eq!(ok.body["salt"], b64(&[42u8; 16]));
    assert_eq!(ok.body["kdf"]["opslimit"], 4);
}

#[sqlx::test]
async fn delete_account_cascades(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let u = User::new("carol", 3);
    let t = Auth::Cookie(app.register(&u).await);
    app.call(
        "POST",
        "/api/v1/credentials",
        &t,
        Some(json!({"id": uuid::Uuid::new_v4(), "meta": blob(50), "secret": blob(50)})),
    )
    .await;
    app.login("carol", &[0u8; 32]).await;

    let bad = app
        .call("DELETE", "/api/v1/me", &t, Some(json!({"authKey": b64(&[0u8; 32])})))
        .await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);

    let r = app
        .call("DELETE", "/api/v1/me", &t, Some(json!({"authKey": b64(&u.auth_key)})))
        .await;
    assert_eq!(r.status, StatusCode::NO_CONTENT);
    assert!(
        r.headers
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );

    // Throttle rows are unlinkable HMACs and expire on their own TTL, so they are not checked.
    for table in ["users", "sessions", "credentials"] {
        let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("select count(*) from {table}")))
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(n, 0, "{table} should be empty");
    }
    assert_eq!(app.login("carol", &u.auth_key).await.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn sensitive_operations_are_throttled_per_session_not_per_login(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("dan", 4);
    let t = Auth::Cookie(app.register(&u).await);
    for _ in 0..5 {
        let r = app
            .call("DELETE", "/api/v1/me", &t, Some(json!({"authKey": b64(&[0u8; 32])})))
            .await;
        assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    }
    let blocked = app
        .call("DELETE", "/api/v1/me", &t, Some(json!({"authKey": b64(&u.auth_key)})))
        .await;
    assert_eq!(
        blocked.status,
        StatusCode::TOO_MANY_REQUESTS,
        "the session's own bucket is closed"
    );
    assert_eq!(
        app.login("dan", &u.auth_key).await.status,
        StatusCode::OK,
        "anonymous login uses separate buckets"
    );
}

#[sqlx::test]
async fn lists_and_revokes_own_sessions_only(db: PgPool) {
    use axum::{body::Body, http::Request};
    let app = TestApp::new(db, &[]);
    let u = User::new("multi", 31);
    let laptop = app.register(&u).await;
    let phone = app
        .send(
            Request::post("/api/v1/auth/login")
                .header(header::ORIGIN, common::ORIGIN)
                .header("x-r16a-request", "1")
                .header(header::USER_AGENT, "r16a vault mobile (Android)")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"username": "multi", "authKey": b64(&u.auth_key), "client": "web"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .cookie_token()
        .unwrap();

    let list = app
        .call("GET", "/api/v1/me/sessions", &Auth::Cookie(laptop.clone()), None)
        .await;
    let rows = list.body.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows.iter().filter(|r| r["current"] == true).count(), 1);
    let other = rows.iter().find(|r| r["current"] == false).unwrap();
    assert_eq!(other["userAgent"], "r16a vault mobile (Android)");
    let current_id = rows.iter().find(|r| r["current"] == true).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // A stranger cannot see or end these sessions.
    let stranger = Auth::Cookie(app.register(&User::new("stranger", 32)).await);
    let path = format!("/api/v1/me/sessions/{}", other["id"].as_str().unwrap());
    assert_eq!(
        app.call("DELETE", &path, &stranger, None).await.status,
        StatusCode::NOT_FOUND
    );

    assert_eq!(
        app.call(
            "DELETE",
            &format!("/api/v1/me/sessions/{current_id}"),
            &Auth::Cookie(laptop.clone()),
            None
        )
        .await
        .status,
        StatusCode::BAD_REQUEST,
        "the current session ends with logout"
    );
    assert_eq!(
        app.call("DELETE", &path, &Auth::Cookie(laptop.clone()), None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(phone), None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call("GET", "/api/v1/me", &Auth::Cookie(laptop), None).await.status,
        StatusCode::OK
    );
}
