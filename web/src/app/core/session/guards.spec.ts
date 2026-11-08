import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';

import { VaultSessionStore } from '../vault/vault-session.store';
import { anonymousGuard, lockedGuard, unlockedGuard } from './guards';
import { SessionService } from './session.service';

describe('route guards', () => {
  let store: VaultSessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SessionService, useValue: { bootstrap: () => Promise.resolve() } },
      ],
    });
    store = TestBed.inject(VaultSessionStore);
  });

  const run = async (guard: typeof anonymousGuard): Promise<string | true> => {
    const result = await TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    if (result === true) return true;
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  };

  it('routes anonymous users to sign in', async () => {
    store.setAnonymous();
    expect(await run(anonymousGuard)).toBe(true);
    expect(await run(lockedGuard)).toBe('/login');
    expect(await run(unlockedGuard)).toBe('/login');
  });

  it('routes locked sessions to unlock', async () => {
    store.setLocked('alice');
    expect(await run(anonymousGuard)).toBe('/unlock');
    expect(await run(lockedGuard)).toBe(true);
    expect(await run(unlockedGuard)).toBe('/unlock');
  });

  it('admits unlocked sessions to the vault only', async () => {
    store.setUnlocked('alice', new Uint8Array(32));
    expect(await run(anonymousGuard)).toBe('/vault');
    expect(await run(lockedGuard)).toBe('/vault');
    expect(await run(unlockedGuard)).toBe(true);
  });
});

describe('VaultSessionStore', () => {
  it('wipes the vault key on lock', async () => {
    const store = new VaultSessionStore();
    const key = new Uint8Array(32).fill(7);
    store.setUnlocked('alice', key);
    expect(await store.withKey(async (k) => k[0])).toBe(7);
    store.lock();
    expect(key.every((b) => b === 0)).toBe(true);
    await expect(store.withKey(async () => 1)).rejects.toThrow();
    expect(store.status()).toBe('locked');
  });
});
