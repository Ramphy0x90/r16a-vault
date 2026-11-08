//! Resolves the client address used for per IP rate limiting.

use std::net::{IpAddr, SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::request::Parts,
};
use ipnet::IpNet;

use crate::{error::AppError, state::AppState};

#[derive(Debug, Clone, Copy)]
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let peer = ConnectInfo::<SocketAddr>::from_request_parts(parts, state)
            .await
            .map(|c| c.0.ip())
            .map_err(|_| AppError::internal("connect info missing"))?;
        let xff = parts
            .headers
            .get_all("x-forwarded-for")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .collect::<Vec<_>>()
            .join(",");
        Ok(Self(resolve(peer, &xff, &state.config.trusted_proxies)))
    }
}

/// Walks X-Forwarded-For from the right, skipping hops that are trusted proxies, and
/// stops at the first untrusted address. Anything left of that point is client
/// controlled and therefore ignored. Without a trusted peer the header is ignored entirely.
pub fn resolve(peer: IpAddr, xff: &str, trusted: &[IpNet]) -> IpAddr {
    let is_trusted = |ip: &IpAddr| trusted.iter().any(|net| net.contains(ip));
    if !is_trusted(&peer) {
        return peer;
    }
    let mut candidate = peer;
    for hop in xff.rsplit(',').map(str::trim).filter(|s| !s.is_empty()) {
        let Ok(ip) = hop.parse::<IpAddr>() else {
            break;
        };
        candidate = ip;
        if !is_trusted(&ip) {
            break;
        }
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn untrusted_peer_ignores_header() {
        let trusted = vec!["10.0.0.0/8".parse().unwrap()];
        assert_eq!(resolve(ip("203.0.113.9"), "1.2.3.4", &trusted), ip("203.0.113.9"));
    }

    #[test]
    fn trusted_peer_uses_rightmost_untrusted_hop() {
        let trusted = vec!["10.0.0.0/8".parse().unwrap()];
        assert_eq!(
            resolve(ip("10.0.0.2"), "6.6.6.6, 198.51.100.7, 10.0.0.5", &trusted),
            ip("198.51.100.7")
        );
    }

    #[test]
    fn garbage_header_falls_back_to_peer() {
        let trusted = vec!["10.0.0.0/8".parse().unwrap()];
        assert_eq!(resolve(ip("10.0.0.2"), "not-an-ip", &trusted), ip("10.0.0.2"));
    }
}
