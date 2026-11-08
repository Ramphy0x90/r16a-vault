//! Shared application state handed to every handler.

use std::sync::Arc;

use secrecy::ExposeSecret;
use sqlx::PgPool;
use tokio::sync::Semaphore;
use zeroize::Zeroizing;

use crate::{config::Config, crypto, error::AppError, http::rate_limit::IpRateLimiter, oidc::provider::Provider};

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    /// Applies to every endpoint that checks a password proof or creates an account.
    pub ip_limiter: IpRateLimiter,
    /// Prelogin precedes every proof and reveals nothing secret, so it gets a larger
    /// budget of its own instead of draining the proof budget.
    pub prelogin_limiter: IpRateLimiter,
    /// Caps concurrent server side Argon2 runs so a login flood cannot exhaust memory.
    argon_permits: Arc<Semaphore>,
    /// Verified against when the username is unknown, so both paths cost one Argon2 run.
    pub dummy_hash: Arc<String>,
    /// Present only when OIDC is enabled in the configuration.
    pub oidc: Option<Arc<Provider>>,
}

impl AppState {
    pub fn new(db: PgPool, config: Config) -> Result<Self, AppError> {
        let workers = std::thread::available_parallelism().map_or(2, std::num::NonZero::get);
        let dummy_key = Zeroizing::new(crypto::random_bytes::<32>()?);
        let dummy_hash = crypto::hash_auth_key(dummy_key.as_slice(), config.pepper())?;
        let oidc = match &config.oidc {
            Some(cfg) => Some(Arc::new(Provider::new(cfg, &config.public_url)?)),
            None => None,
        };
        Ok(Self {
            oidc,
            db,
            ip_limiter: IpRateLimiter::new(config.rate_limit_burst, config.rate_limit_period),
            prelogin_limiter: IpRateLimiter::new(
                config.rate_limit_burst.saturating_mul(3),
                config.rate_limit_period / 3,
            ),
            config: Arc::new(config),
            argon_permits: Arc::new(Semaphore::new(workers * 2)),
            dummy_hash: Arc::new(dummy_hash),
        })
    }

    pub fn prelogin_secret(&self) -> &[u8] {
        self.config.prelogin_secret.expose_secret()
    }

    fn pepper_owned(&self) -> Option<Zeroizing<Vec<u8>>> {
        self.config.pepper().map(|p| Zeroizing::new(p.to_vec()))
    }

    pub async fn hash_auth_key(&self, key: Zeroizing<Vec<u8>>) -> Result<String, AppError> {
        let _permit = self.argon_permits.acquire().await.map_err(AppError::internal)?;
        let pepper = self.pepper_owned();
        tokio::task::spawn_blocking(move || crypto::hash_auth_key(&key, pepper.as_deref().map(Vec::as_slice)))
            .await
            .map_err(AppError::internal)?
    }

    pub async fn verify_auth_key(&self, key: Zeroizing<Vec<u8>>, phc: String) -> Result<bool, AppError> {
        let _permit = self.argon_permits.acquire().await.map_err(AppError::internal)?;
        let pepper = self.pepper_owned();
        tokio::task::spawn_blocking(move || crypto::verify_auth_key(&key, &phc, pepper.as_deref().map(Vec::as_slice)))
            .await
            .map_err(AppError::internal)?
    }
}
