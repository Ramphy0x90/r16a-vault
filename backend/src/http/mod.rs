//! HTTP plumbing shared by every feature. Extractors, request ids, CSRF and rate limiting.

pub mod client_ip;
pub mod csrf;
pub mod json;
pub mod rate_limit;
pub mod request_id;
pub mod wire;
