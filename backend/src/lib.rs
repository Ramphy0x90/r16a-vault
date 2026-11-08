//! r16a-vault backend. A zero knowledge credential store that keeps only ciphertext.
#![forbid(unsafe_code)]

pub mod account;
pub mod app;
pub mod auth;
pub mod config;
pub mod credentials;
pub mod crypto;
pub mod error;
pub mod http;
pub mod oidc;
pub mod openapi;
pub mod sessions;
pub mod state;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
