//! JSON body extractor that maps every rejection to a generic problem response,
//! so framework error strings (which may echo input) never reach the client.

use axum::{
    extract::{FromRequest, Request, rejection::JsonRejection},
    http::StatusCode,
};
use serde::de::DeserializeOwned;

use crate::error::AppError;

pub struct ApiJson<T>(pub T);

impl<S, T> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, AppError> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(v)) => Ok(Self(v)),
            Err(JsonRejection::BytesRejection(e)) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => {
                Err(AppError::PayloadTooLarge("payload-too-large"))
            }
            Err(JsonRejection::MissingJsonContentType(_)) => Err(AppError::BadRequest("unsupported-media-type")),
            Err(_) => Err(AppError::BadRequest("invalid-body")),
        }
    }
}
