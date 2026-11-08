//! OpenID Connect sign in with Authentik or a compatible provider (SPEC 4.10).
//!
//! The provider only proves identity. Every account still has a master password, and an
//! OIDC sign in yields a pre auth session that unlocks only after the usual key proof.

pub mod cookies;
pub mod handlers;
pub mod provider;
pub mod repository;
pub mod service;
