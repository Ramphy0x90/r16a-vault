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

    for table in ["users", "sessions", "credentials", "login_throttle"] {
        let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("select count(*) from {table}")))
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(n, 0, "{table} should be empty");
    }
    assert_eq!(app.login("carol", &u.auth_key).await.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn sensitive_operations_share_the_login_throttle(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let u = User::new("dan", 4);
    let t = Auth::Cookie(app.register(&u).await);
    for _ in 0..5 {
        app.call("DELETE", "/api/v1/me", &t, Some(json!({"authKey": b64(&[0u8; 32])})))
            .await;
    }
    assert_eq!(
        app.login("dan", &u.auth_key).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
}
