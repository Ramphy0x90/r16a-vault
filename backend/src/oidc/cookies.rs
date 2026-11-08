//! Short lived cookies used only during an OIDC sign in.

use axum::http::{HeaderMap, HeaderValue};

use crate::config::Config;

pub const FLOW_MAX_AGE: u64 = 600;

/// Binds a web flow to the browser that started it. It must reach the callback, which is a
/// top level navigation from the provider, so it is SameSite=Lax rather than Strict.
pub fn flow_name(config: &Config) -> &'static str {
    if config.dev_insecure_cookie {
        "r16a_oidc_flow"
    } else {
        "__Host-oidc-flow"
    }
}

/// Lets the register page finish a first OIDC sign in. Only same origin requests need it.
pub fn pending_name(config: &Config) -> &'static str {
    if config.dev_insecure_cookie {
        "r16a_oidc_pending"
    } else {
        "__Host-oidc-pending"
    }
}

fn build(config: &Config, name: &str, value: &str, same_site: &str, max_age: u64) -> HeaderValue {
    let secure = if config.dev_insecure_cookie { "" } else { "; Secure" };
    HeaderValue::from_str(&format!(
        "{name}={value}; Path=/; HttpOnly; SameSite={same_site}; Max-Age={max_age}{secure}"
    ))
    .expect("cookie values are base64url")
}

pub fn set_flow(config: &Config, value: &str) -> HeaderValue {
    build(config, flow_name(config), value, "Lax", FLOW_MAX_AGE)
}

pub fn clear_flow(config: &Config) -> HeaderValue {
    build(config, flow_name(config), "", "Lax", 0)
}

pub fn set_pending(config: &Config, value: &str) -> HeaderValue {
    build(config, pending_name(config), value, "Strict", FLOW_MAX_AGE)
}

pub fn clear_pending(config: &Config) -> HeaderValue {
    build(config, pending_name(config), "", "Strict", 0)
}

pub fn read<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    crate::sessions::cookie::read(headers, name)
}
