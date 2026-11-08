import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';

import { VaultSessionStore, type VaultStatus } from '../vault/vault-session.store';
import { SessionService } from './session.service';

const HOME: Record<Exclude<VaultStatus, 'unknown'>, string> = {
  anonymous: '/login',
  locked: '/unlock',
  unlocked: '/vault',
};

/** Builds a guard that admits one lock state and redirects every other state to its home. */
function allowOnly(wanted: Exclude<VaultStatus, 'unknown'>): CanActivateFn {
  return async (): Promise<boolean | UrlTree> => {
    const session = inject(SessionService);
    const store = inject(VaultSessionStore);
    const router = inject(Router);
    await session.bootstrap();
    const status = store.status();
    if (status === wanted) return true;
    return router.parseUrl(status === 'unknown' ? '/login' : HOME[status]);
  };
}

export const anonymousGuard = allowOnly('anonymous');
export const lockedGuard = allowOnly('locked');
export const unlockedGuard = allowOnly('unlocked');
