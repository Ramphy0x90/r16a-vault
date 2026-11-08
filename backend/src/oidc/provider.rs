//! Discovery document and signing keys, cached so a key rotation at the provider is picked
//! up within minutes without a restart.

use std::time::{Duration, Instant};

use openidconnect::{
    ClientId, ClientSecret, EndpointMaybeSet, EndpointNotSet, EndpointSet, IssuerUrl, RedirectUrl,
    core::{CoreClient, CoreProviderMetadata},
    reqwest,
};
use secrecy::ExposeSecret;
use tokio::sync::RwLock;

use crate::{config::OidcConfig, error::AppError};

const METADATA_TTL: Duration = Duration::from_secs(600);

pub type Client =
    CoreClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointMaybeSet, EndpointMaybeSet>;

pub struct Provider {
    pub http: reqwest::Client,
    issuer: IssuerUrl,
    client_id: ClientId,
    client_secret: ClientSecret,
    redirect: RedirectUrl,
    cache: RwLock<Option<(CoreProviderMetadata, Instant)>>,
}

impl Provider {
    pub fn new(cfg: &OidcConfig, public_url: &str) -> Result<Self, AppError> {
        let http = reqwest::ClientBuilder::new()
            // Redirects from the provider endpoints would open a path for SSRF.
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(AppError::internal)?;
        Ok(Self {
            http,
            issuer: IssuerUrl::new(cfg.issuer_url.clone()).map_err(AppError::internal)?,
            client_id: ClientId::new(cfg.client_id.clone()),
            client_secret: ClientSecret::new(cfg.client_secret.expose_secret().to_owned()),
            redirect: RedirectUrl::new(format!("{public_url}/api/v1/auth/oidc/callback"))
                .map_err(AppError::internal)?,
            cache: RwLock::new(None),
        })
    }

    /// Builds a client from fresh enough metadata. With `refresh` the cache is bypassed,
    /// which is used once when a signature check fails after a key rotation.
    pub async fn client(&self, refresh: bool) -> Result<Client, AppError> {
        if !refresh
            && let Some((meta, at)) = self.cache.read().await.as_ref()
            && at.elapsed() < METADATA_TTL
        {
            return Ok(self.build(meta.clone()));
        }
        let meta = CoreProviderMetadata::discover_async(self.issuer.clone(), &self.http)
            .await
            .map_err(|e| AppError::internal(format!("oidc discovery failed {e}")))?;
        *self.cache.write().await = Some((meta.clone(), Instant::now()));
        Ok(self.build(meta))
    }

    fn build(&self, meta: CoreProviderMetadata) -> Client {
        CoreClient::from_provider_metadata(meta, self.client_id.clone(), Some(self.client_secret.clone()))
            .set_redirect_uri(self.redirect.clone())
    }
}
