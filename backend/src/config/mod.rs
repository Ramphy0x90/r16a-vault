//! Startup configuration read from environment variables.
//!
//! Every value is validated once at startup so a misconfigured deployment fails fast
//! with a message naming the offending variable. Secret values are never echoed back.

use std::{net::SocketAddr, time::Duration};

use ipnet::IpNet;
use secrecy::{ExposeSecret, SecretBox, SecretString};

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{0} is required but not set")]
    Missing(&'static str),
    #[error("{name} is invalid, {reason}")]
    Invalid { name: &'static str, reason: String },
}

/// Client Argon2id parameters the server hands out to new or unknown accounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub opslimit: u32,
    pub memlimit: u64,
}

impl KdfParams {
    /// Matches the client floor, so prelogin for an unknown user looks like a fresh account.
    pub const DEFAULT: Self = Self {
        opslimit: 3,
        memlimit: 64 * 1024 * 1024,
    };
    pub const MIN_OPSLIMIT: u32 = 3;
    pub const MAX_OPSLIMIT: u32 = 10;
    pub const MIN_MEMLIMIT: u64 = 64 * 1024 * 1024;
    pub const MAX_MEMLIMIT: u64 = 1024 * 1024 * 1024;

    pub fn is_acceptable(self) -> bool {
        (Self::MIN_OPSLIMIT..=Self::MAX_OPSLIMIT).contains(&self.opslimit)
            && (Self::MIN_MEMLIMIT..=Self::MAX_MEMLIMIT).contains(&self.memlimit)
    }
}

/// Authentik or any other OpenID Connect provider. Absent unless R16A_OIDC_ENABLED is true.
#[derive(Debug)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: SecretString,
    pub display_name: String,
    pub scopes: Vec<String>,
    /// Verified https link (Android App Link, iOS associated domain) that hands the one time
    /// code to the mobile app. Only the genuine app can claim it, unlike a custom scheme.
    pub mobile_redirect: String,
    /// Browser extension redirect URLs (`identity.getRedirectURL`) that may receive a one
    /// time code. Exact values only. Empty disables single sign on from the extension.
    pub extension_redirects: Vec<String>,
}

#[derive(Debug)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: SecretString,
    /// Used only by the `migrate` subcommand, falls back to `database_url`.
    pub migrate_database_url: Option<SecretString>,
    pub public_origin: String,
    /// Further origins accepted by the CSRF check. Development only, so `ng serve` and the
    /// dockerised web app can share one local backend.
    pub extra_origins: Vec<String>,
    /// Optional restriction on which browser extension origins may sign in. Empty means any
    /// well formed `chrome-extension://` or `moz-extension://` origin is accepted, which store
    /// installs need because Firefox gives every install its own random origin. The CSRF layer
    /// accepts extension origins only on requests that carry no session cookie, see `http::csrf`.
    pub extension_origins: Vec<String>,
    pub prelogin_secret: SecretBox<Vec<u8>>,
    pub auth_pepper: Option<SecretBox<Vec<u8>>>,
    pub session_idle: Duration,
    pub session_absolute: Duration,
    pub dev_insecure_cookie: bool,
    pub trusted_proxies: Vec<IpNet>,
    pub registration_enabled: bool,
    /// Operator's privacy notice, linked from the sign in pages of both apps when set.
    pub privacy_url: Option<String>,
    pub migrate_on_start: bool,
    pub throttle_ttl: Duration,
    pub rate_limit_burst: u32,
    pub rate_limit_period: Duration,
    pub log_json: bool,
    pub expose_openapi: bool,
    pub db_max_connections: u32,
    pub public_url: String,
    pub oidc: Option<OidcConfig>,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// Takes a lookup function so tests can build configs without touching process env.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |k: &str| get(k).filter(|v| !v.trim().is_empty());

        let bind = parse_or(&get, "R16A_BIND", "0.0.0.0:8081".parse().expect("valid literal"))?;
        let database_url = get("R16A_DATABASE_URL")
            .map(SecretString::from)
            .ok_or(ConfigError::Missing("R16A_DATABASE_URL"))?;
        let migrate_database_url = get("R16A_MIGRATE_DATABASE_URL").map(SecretString::from);

        let public_url = get("R16A_PUBLIC_URL").ok_or(ConfigError::Missing("R16A_PUBLIC_URL"))?;
        let public_origin = origin_of(&public_url).ok_or_else(|| ConfigError::Invalid {
            name: "R16A_PUBLIC_URL",
            reason: "expected an absolute http or https URL such as https://vault.example.com".into(),
        })?;

        let dev_insecure_cookie = parse_or(&get, "R16A_DEV_INSECURE_COOKIE", false)?;
        let prelogin_secret = secret_bytes(&get, "R16A_PRELOGIN_SECRET", dev_insecure_cookie)?
            .ok_or(ConfigError::Missing("R16A_PRELOGIN_SECRET"))?;
        let auth_pepper = secret_bytes(&get, "R16A_AUTH_PEPPER", dev_insecure_cookie)?;

        let session_idle = Duration::from_secs(parse_or(&get, "R16A_SESSION_IDLE_SECS", 1800u64)?);
        let session_absolute = Duration::from_secs(parse_or(&get, "R16A_SESSION_ABSOLUTE_SECS", 43_200u64)?);
        if session_idle.as_secs() < 60 || session_absolute < session_idle {
            return Err(ConfigError::Invalid {
                name: "R16A_SESSION_IDLE_SECS",
                reason: "idle timeout must be at least 60 and not exceed the absolute lifetime".into(),
            });
        }

        if dev_insecure_cookie && public_origin.starts_with("https://") {
            return Err(ConfigError::Invalid {
                name: "R16A_DEV_INSECURE_COOKIE",
                reason: "must not be enabled when R16A_PUBLIC_URL uses https".into(),
            });
        }

        let trusted_proxies = match get("R16A_TRUSTED_PROXY_CIDRS") {
            None => Vec::new(),
            Some(list) => list
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| {
                    s.parse::<IpNet>().map_err(|_| ConfigError::Invalid {
                        name: "R16A_TRUSTED_PROXY_CIDRS",
                        reason: format!("'{s}' is not a CIDR such as 10.0.0.0/8"),
                    })
                })
                .collect::<Result<_, _>>()?,
        };

        let rate_limit_burst = parse_or(&get, "R16A_RATE_LIMIT_BURST", 10u32)?;
        if rate_limit_burst == 0 {
            return Err(ConfigError::Invalid {
                name: "R16A_RATE_LIMIT_BURST",
                reason: "must be at least 1".into(),
            });
        }
        let rate_limit_period = Duration::from_millis(parse_or(&get, "R16A_RATE_LIMIT_PERIOD_MS", 6000u64)?.max(1));

        let oidc = if parse_or(&get, "R16A_OIDC_ENABLED", false)? {
            let required = |name: &'static str| get(name).ok_or(ConfigError::Missing(name));
            let issuer_url = required("R16A_OIDC_ISSUER_URL")?;
            if !issuer_url.starts_with("https://") && !dev_insecure_cookie {
                return Err(ConfigError::Invalid {
                    name: "R16A_OIDC_ISSUER_URL",
                    reason: "must use https".into(),
                });
            }
            // Custom schemes can be claimed by any app on the phone, so the code would be
            // exposed to whichever app wins the redirect. Only a verified link on our own
            // origin is accepted.
            let mobile_redirect = get("R16A_OIDC_MOBILE_REDIRECT")
                .unwrap_or_else(|| format!("{}/app/oidc-callback", public_url.trim_end_matches('/')));
            let same_origin = origin_of(&mobile_redirect).is_some_and(|o| o == public_origin);
            if !same_origin || !mobile_redirect.starts_with("https://") && !dev_insecure_cookie {
                return Err(ConfigError::Invalid {
                    name: "R16A_OIDC_MOBILE_REDIRECT",
                    reason: "must be an https link on R16A_PUBLIC_URL that the app verifies as an App Link and associated domain".into(),
                });
            }
            Some(OidcConfig {
                issuer_url,
                client_id: required("R16A_OIDC_CLIENT_ID")?,
                client_secret: SecretString::from(required("R16A_OIDC_CLIENT_SECRET")?),
                display_name: get("R16A_OIDC_DISPLAY_NAME").unwrap_or_else(|| String::from("Authentik")),
                scopes: get("R16A_OIDC_SCOPES")
                    .unwrap_or_else(|| String::from("openid profile"))
                    .split_whitespace()
                    .filter(|s| *s != "openid")
                    .map(str::to_owned)
                    .collect(),
                mobile_redirect,
                extension_redirects: list(&get, "R16A_OIDC_EXTENSION_REDIRECTS", |s| {
                    extension_redirect(s).ok_or_else(|| {
                        format!("'{s}' is not an https chromiumapp.org or extensions.allizom.org redirect URL")
                    })
                })?,
            })
        } else {
            None
        };

        let extra_origins = match get("R16A_EXTRA_ORIGINS") {
            None => Vec::new(),
            Some(_) if !dev_insecure_cookie => {
                return Err(ConfigError::Invalid {
                    name: "R16A_EXTRA_ORIGINS",
                    reason: "is only allowed together with R16A_DEV_INSECURE_COOKIE for local development".into(),
                });
            }
            Some(list) => list
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| {
                    origin_of(s).ok_or_else(|| ConfigError::Invalid {
                        name: "R16A_EXTRA_ORIGINS",
                        reason: format!("'{s}' is not an http or https origin"),
                    })
                })
                .collect::<Result<_, _>>()?,
        };

        let extension_origins = list(&get, "R16A_EXTENSION_ORIGINS", |s| {
            extension_origin(s).ok_or_else(|| format!("'{s}' is not a chrome-extension or moz-extension origin"))
        })?;

        Ok(Self {
            extension_origins,
            extra_origins,
            oidc,
            public_url: public_url.trim_end_matches('/').to_owned(),
            bind,
            database_url,
            migrate_database_url,
            public_origin,
            prelogin_secret,
            auth_pepper,
            session_idle,
            session_absolute,
            dev_insecure_cookie,
            trusted_proxies,
            registration_enabled: parse_or(&get, "R16A_REGISTRATION_ENABLED", true)?,
            privacy_url: match get("R16A_PRIVACY_URL") {
                None => None,
                Some(u) if u.starts_with("https://") || u.starts_with("http://") => Some(u),
                Some(_) => {
                    return Err(ConfigError::Invalid {
                        name: "R16A_PRIVACY_URL",
                        reason: "must be an absolute http or https URL".into(),
                    });
                }
            },
            migrate_on_start: parse_or(&get, "R16A_MIGRATE_ON_START", false)?,
            throttle_ttl: Duration::from_secs(parse_or(&get, "R16A_THROTTLE_TTL_SECS", 86_400u64)?),
            rate_limit_burst,
            rate_limit_period,
            log_json: get("R16A_LOG_FORMAT").is_none_or(|v| v != "pretty"),
            expose_openapi: parse_or(&get, "R16A_EXPOSE_OPENAPI", false)?,
            db_max_connections: parse_or(&get, "R16A_DB_MAX_CONNECTIONS", 10u32)?,
        })
    }

    pub fn cookie_name(&self) -> &'static str {
        if self.dev_insecure_cookie {
            "r16a_session_dev"
        } else {
            "__Host-session"
        }
    }

    pub fn pepper(&self) -> Option<&[u8]> {
        self.auth_pepper.as_ref().map(|p| p.expose_secret().as_slice())
    }
}

fn parse_or<T: std::str::FromStr>(
    get: &impl Fn(&str) -> Option<String>,
    name: &'static str,
    default: T,
) -> Result<T, ConfigError> {
    match get(name) {
        None => Ok(default),
        Some(v) => v.trim().parse().map_err(|_| ConfigError::Invalid {
            name,
            reason: "could not be parsed".into(),
        }),
    }
}

/// Words that only appear in shipped templates and examples. A secret containing one was
/// never replaced, and its value is public.
const PLACEHOLDER_MARKERS: [&str; 5] = ["replace", "change-me", "changeme", "placeholder", "example"];

/// Secrets must look generated. Length alone is not enough, because the shipped placeholders
/// are long. Values from the repository templates are refused, the published development
/// values are refused outside development mode, and very repetitive values are refused.
fn secret_bytes(
    get: &impl Fn(&str) -> Option<String>,
    name: &'static str,
    dev_mode: bool,
) -> Result<Option<SecretBox<Vec<u8>>>, ConfigError> {
    let Some(v) = get(name) else {
        return Ok(None);
    };
    let lower = v.to_ascii_lowercase();
    let invalid = |reason: &str| ConfigError::Invalid {
        name,
        reason: format!("{reason}, generate one with `openssl rand -base64 48`"),
    };
    if v.len() < 32 {
        return Err(invalid("must be at least 32 characters"));
    }
    if PLACEHOLDER_MARKERS.iter().any(|m| lower.contains(m)) {
        return Err(invalid("still holds a template placeholder"));
    }
    if lower.contains("dev-only") && !dev_mode {
        return Err(invalid("holds the public development value outside development mode"));
    }
    let distinct = v.chars().collect::<std::collections::HashSet<_>>().len();
    if distinct < 12 {
        return Err(invalid("is too repetitive to be random"));
    }
    Ok(Some(SecretBox::new(Box::new(v.into_bytes()))))
}

/// Reduces a URL to scheme, host and port, which is what browsers put in the Origin header.
/// Parses a comma separated list, validating and normalising every entry.
fn list(
    get: &impl Fn(&str) -> Option<String>,
    name: &'static str,
    check: impl Fn(&str) -> Result<String, String>,
) -> Result<Vec<String>, ConfigError> {
    get(name)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| check(s).map_err(|reason| ConfigError::Invalid { name, reason }))
        .collect()
}

/// Chrome extension ids are 32 letters from a to p. Firefox origins carry a random UUID that
/// differs per install. Returns the lowercased origin, or nothing when the shape is wrong.
pub fn extension_origin(s: &str) -> Option<String> {
    let s = s.to_ascii_lowercase();
    if let Some(id) = s.strip_prefix("chrome-extension://") {
        return (id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))).then_some(s);
    }
    let uuid = s.strip_prefix("moz-extension://")?;
    let groups: Vec<&str> = uuid.split('-').collect();
    let shape = groups.iter().map(|g| g.len()).collect::<Vec<_>>() == [8, 4, 4, 4, 12];
    (shape && groups.iter().all(|g| g.bytes().all(|b| b.is_ascii_hexdigit()))).then_some(s)
}

/// Only the browser owned redirect hosts are accepted. No website can serve them, the
/// browser hands the navigation to the extension that started the flow.
fn extension_redirect(s: &str) -> Option<String> {
    let rest = s.strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    if path.is_empty() || path.contains(['?', '#']) || host != host.to_ascii_lowercase() {
        return None;
    }
    let label_ok = if let Some(id) = host.strip_suffix(".chromiumapp.org") {
        id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
    } else if let Some(sub) = host.strip_suffix(".extensions.allizom.org") {
        (1..=63).contains(&sub.len()) && sub.bytes().all(|b| b.is_ascii_alphanumeric())
    } else {
        false
    };
    label_ok.then(|| s.to_owned())
}

fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let authority = authority.to_ascii_lowercase();
    let authority = match (scheme.as_str(), authority.rsplit_once(':')) {
        ("https", Some((host, "443"))) | ("http", Some((host, "80"))) => host.to_owned(),
        _ => authority,
    };
    Some(format!("{scheme}://{authority}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn base() -> HashMap<&'static str, String> {
        HashMap::from([
            ("R16A_DATABASE_URL", "postgres://x".to_string()),
            ("R16A_PUBLIC_URL", "https://vault.example.com/".to_string()),
            ("R16A_PRELOGIN_SECRET", "k9Q2vX7mLp4Rt8Wz1Yb6Nc3Hd5Fg0JsAe".to_string()),
        ])
    }

    fn load(env: &HashMap<&'static str, String>) -> Result<Config, ConfigError> {
        Config::from_lookup(|k| env.get(k).cloned())
    }

    #[test]
    fn accepts_minimal_config() {
        let cfg = load(&base()).expect("valid");
        assert_eq!(cfg.public_origin, "https://vault.example.com");
        assert_eq!(cfg.cookie_name(), "__Host-session");
    }

    #[test]
    fn rejects_short_secret() {
        let mut env = base();
        env.insert("R16A_PRELOGIN_SECRET", "short".into());
        assert!(matches!(
            load(&env),
            Err(ConfigError::Invalid {
                name: "R16A_PRELOGIN_SECRET",
                ..
            })
        ));
    }

    #[test]
    fn rejects_placeholder_dev_and_repetitive_secrets() {
        for bad in [
            "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS",
            "dev-only-prelogin-secret-0123456789abcdef",
            &"ab".repeat(20),
        ] {
            let mut env = base();
            env.insert("R16A_PRELOGIN_SECRET", bad.into());
            assert!(load(&env).is_err(), "{bad}");
        }
        let mut dev = base();
        dev.insert("R16A_PUBLIC_URL", "http://localhost:4200".into());
        dev.insert("R16A_DEV_INSECURE_COOKIE", "true".into());
        dev.insert(
            "R16A_PRELOGIN_SECRET",
            "dev-only-prelogin-secret-0123456789abcdef".into(),
        );
        assert!(load(&dev).is_ok(), "development values are fine in development mode");
    }

    #[test]
    fn refuses_insecure_cookie_on_https() {
        let mut env = base();
        env.insert("R16A_DEV_INSECURE_COOKIE", "true".into());
        assert!(load(&env).is_err());
        env.insert("R16A_PUBLIC_URL", "http://localhost:8080".into());
        assert_eq!(load(&env).expect("valid").cookie_name(), "r16a_session_dev");
    }

    #[test]
    fn missing_secret_names_variable_only() {
        let mut env = base();
        env.remove("R16A_PRELOGIN_SECRET");
        let msg = load(&env).unwrap_err().to_string();
        assert!(msg.contains("R16A_PRELOGIN_SECRET"));
    }

    #[test]
    fn oidc_requires_its_settings_and_only_verified_mobile_links() {
        let mut env = base();
        env.insert("R16A_OIDC_ENABLED", "true".into());
        assert!(matches!(load(&env), Err(ConfigError::Missing("R16A_OIDC_ISSUER_URL"))));
        env.insert(
            "R16A_OIDC_ISSUER_URL",
            "https://auth.example.com/application/o/vault/".into(),
        );
        env.insert("R16A_OIDC_CLIENT_ID", "vault".into());
        env.insert("R16A_OIDC_CLIENT_SECRET", "s".into());
        let cfg = load(&env).expect("valid");
        assert_eq!(
            cfg.oidc.as_ref().map(|o| o.scopes.clone()),
            Some(vec![String::from("profile")])
        );
        assert_eq!(
            load(&env).expect("valid").oidc.unwrap().mobile_redirect,
            "https://vault.example.com/app/oidc-callback"
        );
        for bad in [
            "r16avault://oidc-callback",
            "https://evil.example/cb",
            "http://vault.example.com/app/oidc-callback",
        ] {
            env.insert("R16A_OIDC_MOBILE_REDIRECT", bad.into());
            assert!(load(&env).is_err(), "{bad}");
        }
    }

    #[test]
    fn extra_origins_only_in_development() {
        let mut env = base();
        env.insert("R16A_EXTRA_ORIGINS", "http://localhost:8080".into());
        assert!(matches!(
            load(&env),
            Err(ConfigError::Invalid {
                name: "R16A_EXTRA_ORIGINS",
                ..
            })
        ));
        env.insert("R16A_PUBLIC_URL", "http://localhost:4200".into());
        env.insert("R16A_DEV_INSECURE_COOKIE", "true".into());
        assert_eq!(
            load(&env).expect("valid").extra_origins,
            vec![String::from("http://localhost:8080")]
        );
    }

    #[test]
    fn extension_origins_and_redirects_are_exact_browser_values() {
        let chrome = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
        let firefox = "moz-extension://0F3C3A6E-8A8C-4C4E-9B8F-2D6A1C0E5B7D";
        assert_eq!(extension_origin(chrome).as_deref(), Some(chrome));
        assert_eq!(
            extension_origin(firefox).as_deref(),
            Some("moz-extension://0f3c3a6e-8a8c-4c4e-9b8f-2d6a1c0e5b7d")
        );
        for bad in [
            "chrome-extension://abcdefghijklmnopabcdefghijklmnoz",
            "chrome-extension://short",
            "moz-extension://not-a-uuid",
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
            "https://vault.example.com",
            "*",
        ] {
            assert_eq!(extension_origin(bad), None, "{bad}");
        }

        assert!(extension_redirect("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oidc").is_some());
        assert!(extension_redirect("https://3f2a9b.extensions.allizom.org/oidc").is_some());
        for bad in [
            "http://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oidc",
            "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/",
            "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oidc?x=1",
            "https://evil.chromiumapp.org.example/oidc",
            "https://a.b.extensions.allizom.org/oidc",
            "https://vault.example.com/oidc",
        ] {
            assert_eq!(extension_redirect(bad), None, "{bad}");
        }

        let mut env = base();
        env.insert("R16A_EXTENSION_ORIGINS", format!("{chrome}, {firefox}"));
        assert_eq!(load(&env).expect("valid").extension_origins.len(), 2);
        env.insert("R16A_EXTENSION_ORIGINS", "*".into());
        assert!(matches!(
            load(&env),
            Err(ConfigError::Invalid {
                name: "R16A_EXTENSION_ORIGINS",
                ..
            })
        ));
    }

    #[test]
    fn origin_normalisation() {
        assert_eq!(
            origin_of("HTTPS://Vault.Example.com:443/x").as_deref(),
            Some("https://vault.example.com")
        );
        assert_eq!(
            origin_of("http://localhost:8080").as_deref(),
            Some("http://localhost:8080")
        );
        assert_eq!(origin_of("ftp://x"), None);
        assert_eq!(origin_of("https://u@x"), None);
    }
}
