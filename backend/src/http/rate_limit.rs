//! Per client IP rate limiting for unauthenticated and password proof endpoints.
//!
//! This is an in memory GCRA limiter per replica. The global, account level defence is
//! the database backed throttle in `auth::throttle`.

use std::{net::IpAddr, num::NonZeroU32, sync::Arc, time::Duration};

use governor::{
    DefaultKeyedRateLimiter, Quota, RateLimiter,
    clock::{Clock, DefaultClock},
};

use crate::error::AppError;

#[derive(Clone)]
pub struct IpRateLimiter {
    inner: Arc<DefaultKeyedRateLimiter<IpAddr>>,
}

impl IpRateLimiter {
    pub fn new(burst: u32, period: Duration) -> Self {
        let burst = NonZeroU32::new(burst).unwrap_or(NonZeroU32::MIN);
        let quota = Quota::with_period(period)
            .unwrap_or_else(|| Quota::per_second(NonZeroU32::MIN))
            .allow_burst(burst);
        Self {
            inner: Arc::new(RateLimiter::keyed(quota)),
        }
    }

    /// IPv6 clients are bucketed by their /64 since a single host usually controls one.
    pub fn check(&self, ip: IpAddr) -> Result<(), AppError> {
        let key = match ip {
            IpAddr::V4(_) => ip,
            IpAddr::V6(v6) => {
                let mut seg = v6.segments();
                seg[4..].fill(0);
                IpAddr::V6(seg.into())
            }
        };
        self.inner
            .check_key(&key)
            .map_err(|not_until| AppError::TooManyRequests {
                retry_after: not_until.wait_time_from(DefaultClock::default().now()),
            })
    }

    /// Drops idle buckets so memory stays bounded under address churn.
    pub fn prune(&self) {
        self.inner.retain_recent();
        self.inner.shrink_to_fit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_reject() {
        let rl = IpRateLimiter::new(2, Duration::from_secs(60));
        let ip: IpAddr = "192.0.2.1".parse().unwrap();
        assert!(rl.check(ip).is_ok());
        assert!(rl.check(ip).is_ok());
        assert!(matches!(rl.check(ip), Err(AppError::TooManyRequests { .. })));
        assert!(rl.check("192.0.2.2".parse().unwrap()).is_ok());
    }

    #[test]
    fn ipv6_shares_prefix() {
        let rl = IpRateLimiter::new(1, Duration::from_secs(60));
        assert!(rl.check("2001:db8::1".parse().unwrap()).is_ok());
        assert!(rl.check("2001:db8::2".parse().unwrap()).is_err());
    }
}
