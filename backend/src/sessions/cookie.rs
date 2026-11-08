//! Session cookie formatting and parsing.
//!
//! Production uses the `__Host-` prefix, which browsers only accept with Secure,
//! Path=/ and no Domain, pinning the cookie to exactly this origin.

use axum::http::{HeaderMap, HeaderValue, header};

use crate::config::Config;

pub fn set(config: &Config, token: &str) -> HeaderValue {
    let secure = if config.dev_insecure_cookie { "" } else { "; Secure" };
    let max_age = config.session_absolute.as_secs();
    let value = format!(
        "{}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}",
        config.cookie_name()
    );
    HeaderValue::from_str(&value).expect("token is base64url so the header is valid")
}

pub fn clear(config: &Config) -> HeaderValue {
    let secure = if config.dev_insecure_cookie { "" } else { "; Secure" };
    let value = format!(
        "{}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
        config.cookie_name()
    );
    HeaderValue::from_str(&value).expect("static cookie text is a valid header")
}

pub fn read<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v)
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_named_cookie_among_others() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("a=1; __Host-session=tok; b=2"));
        assert_eq!(read(&h, "__Host-session"), Some("tok"));
        assert_eq!(read(&h, "missing"), None);
    }
}
