mod common;

use axum::http::StatusCode;
use common::{Auth, TestApp, User, blob};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

fn new_cred() -> serde_json::Value {
    json!({"id": Uuid::new_v4(), "meta": blob(80), "secret": blob(120)})
}

#[sqlx::test]
async fn create_list_delete(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let t = Auth::Cookie(app.register(&User::new("alice", 1)).await);

    let empty = app.call("GET", "/api/v1/credentials", &t, None).await;
    assert_eq!(empty.body, json!([]));

    let body = new_cred();
    let r = app.call("POST", "/api/v1/credentials", &t, Some(body.clone())).await;
    assert_eq!(r.status, StatusCode::CREATED);
    assert_eq!(r.body["id"], body["id"]);
    assert_eq!(r.body["meta"], body["meta"]);
    assert!(r.body["createdAt"].as_str().is_some());

    let list = app.call("GET", "/api/v1/credentials", &t, None).await;
    assert_eq!(list.body.as_array().unwrap().len(), 1);
    assert_eq!(list.body[0]["secret"], body["secret"]);

    let dup = app.call("POST", "/api/v1/credentials", &t, Some(body.clone())).await;
    assert_eq!(dup.status, StatusCode::CONFLICT);

    let id = body["id"].as_str().unwrap();
    assert_eq!(
        app.call("DELETE", &format!("/api/v1/credentials/{id}"), &t, None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call("DELETE", &format!("/api/v1/credentials/{id}"), &t, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.call("DELETE", "/api/v1/credentials/not-a-uuid", &t, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
async fn rejects_malformed_blobs(db: PgPool) {
    let app = TestApp::new(db, &[]);
    let t = Auth::Cookie(app.register(&User::new("bob", 2)).await);
    let mut wrong_version = new_cred();
    wrong_version["meta"] = json!(common::b64(&[2u8; 60]));
    let mut too_short = new_cred();
    too_short["secret"] = json!(blob(40));
    let mut not_b64 = new_cred();
    not_b64["meta"] = json!("%%%");
    for b in [wrong_version, too_short, not_b64] {
        assert_eq!(
            app.call("POST", "/api/v1/credentials", &t, Some(b)).await.status,
            StatusCode::BAD_REQUEST
        );
    }
    let mut huge = new_cred();
    huge["secret"] = json!(blob(8193));
    assert_eq!(
        app.call("POST", "/api/v1/credentials", &t, Some(huge)).await.status,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let mut max = new_cred();
    max["secret"] = json!(blob(8192));
    assert_eq!(
        app.call("POST", "/api/v1/credentials", &t, Some(max)).await.status,
        StatusCode::CREATED
    );
}

#[sqlx::test]
async fn requires_authentication(db: PgPool) {
    let app = TestApp::new(db, &[]);
    assert_eq!(
        app.call("GET", "/api/v1/credentials", &Auth::None, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call("POST", "/api/v1/credentials", &Auth::None, Some(new_cred()))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test]
async fn cross_user_isolation(db: PgPool) {
    let app = TestApp::new(db.clone(), &[]);
    let a = Auth::Cookie(app.register(&User::new("alice", 1)).await);
    let b = Auth::Cookie(app.register(&User::new("bob", 2)).await);

    let cred = new_cred();
    app.call("POST", "/api/v1/credentials", &a, Some(cred.clone())).await;
    let id = cred["id"].as_str().unwrap();

    assert_eq!(app.call("GET", "/api/v1/credentials", &b, None).await.body, json!([]));
    let del = app.call("DELETE", &format!("/api/v1/credentials/{id}"), &b, None).await;
    assert_eq!(
        del.status,
        StatusCode::NOT_FOUND,
        "foreign rows look missing, not forbidden"
    );

    // Reusing another user's id must not overwrite or reveal their row.
    let mut hijack = new_cred();
    hijack["id"] = json!(id);
    assert_eq!(
        app.call("POST", "/api/v1/credentials", &b, Some(hijack)).await.status,
        StatusCode::CONFLICT
    );

    let list_a = app.call("GET", "/api/v1/credentials", &a, None).await;
    assert_eq!(list_a.body.as_array().unwrap().len(), 1);
    assert_eq!(list_a.body[0]["meta"], cred["meta"]);
}
