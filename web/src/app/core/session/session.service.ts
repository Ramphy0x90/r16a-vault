import { Injectable, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';

import { ApiService } from '../api/api.service';
import type { LoginResponse, MeResponse } from '../api/api.types';
import { VaultCryptoService } from '../crypto/vault-crypto.service';
import { VaultSessionStore } from '../vault/vault-session.store';
import { SessionEvents } from './session-events';

/**
 * Orchestrates every flow that involves the master password. Each flow derives keys,
 * talks to the API and wipes intermediate keys before returning, whatever the outcome.
 */
/** Profile as known right after a full sign in. The creation date is not part of that response. */
function meFrom(res: LoginResponse): MeResponse {
  return {
    id: res.user.id,
    username: res.user.username,
    kdf: res.kdf,
    salt: res.salt,
    sessionState: 'full',
    createdAt: '',
  };
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);
  private readonly crypto = inject(VaultCryptoService);
  private readonly store = inject(VaultSessionStore);
  private readonly router = inject(Router);
  private bootstrapping: Promise<void> | null = null;
  private me: MeResponse | null = null;

  constructor() {
    const events = inject(SessionEvents);
    effect(() => {
      if (events.expiredCount() > 0) untracked(() => this.handleExpiry());
    });
  }

  /** Resolves the initial state once per page load from the session cookie alone. */
  bootstrap(): Promise<void> {
    this.bootstrapping ??= this.api.me().then(
      (me) => {
        this.me = me;
        this.store.setLocked(me.username);
      },
      () => this.store.setAnonymous(),
    );
    return this.bootstrapping;
  }

  async register(username: string, password: string): Promise<void> {
    const vaultKey = await this.crypto.newVaultKey();
    try {
      const material = await this.crypto.createKeyMaterial(password, vaultKey);
      const res = await this.api.register({ username, ...material });
      this.me = meFrom(res);
      this.store.setUnlocked(res.user.username, vaultKey);
    } catch (e) {
      await this.crypto.wipeKey(vaultKey);
      throw e;
    }
  }

  async login(username: string, password: string): Promise<void> {
    const pre = await this.api.prelogin(username);
    const keys = await this.crypto.deriveSubkeys(password, pre.salt, pre.kdf);
    try {
      const res = await this.api.login(username, await this.crypto.authKeyB64(keys));
      const vaultKey = await this.crypto.unwrap(keys, res.wrappedVaultKey);
      this.me = meFrom(res);
      this.store.setUnlocked(res.user.username, vaultKey);
    } finally {
      await this.crypto.wipeSubkeys(keys);
    }
  }

  async unlock(password: string): Promise<void> {
    const me = this.me ?? (await this.api.me());
    const keys = await this.crypto.deriveSubkeys(password, me.salt, me.kdf);
    try {
      const res = await this.api.unlock(await this.crypto.authKeyB64(keys));
      const vaultKey = await this.crypto.unwrap(keys, res.wrappedVaultKey);
      this.me = { ...me, kdf: res.kdf, salt: res.salt, sessionState: 'full' };
      this.store.setUnlocked(me.username, vaultKey);
    } finally {
      await this.crypto.wipeSubkeys(keys);
    }
  }

  lock(): void {
    this.store.lock();
    void this.router.navigateByUrl('/unlock');
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // The local state is cleared regardless, a failed call only leaves a server session to expire.
    }
    this.resetTo('/login');
  }

  async changeMasterPassword(current: string, next: string): Promise<void> {
    const me = this.me ?? (await this.api.me());
    const currentKeys = await this.crypto.deriveSubkeys(current, me.salt, me.kdf);
    try {
      const currentAuthKey = await this.crypto.authKeyB64(currentKeys);
      const material = await this.store.withKey((vaultKey) =>
        this.crypto.createKeyMaterial(next, vaultKey),
      );
      await this.api.changeMasterPassword({
        currentAuthKey,
        newAuthKey: material.authKey,
        newSalt: material.salt,
        newKdf: material.kdf,
        newWrappedVaultKey: material.wrappedVaultKey,
      });
      this.me = { ...me, salt: material.salt, kdf: material.kdf };
    } finally {
      await this.crypto.wipeSubkeys(currentKeys);
    }
  }

  async logoutAll(password: string): Promise<void> {
    await this.proveAnd(password, (authKey) => this.api.logoutAll(authKey));
    this.resetTo('/login');
  }

  async deleteAccount(password: string): Promise<void> {
    await this.proveAnd(password, (authKey) => this.api.deleteAccount(authKey));
    this.resetTo('/login?deleted=1');
  }

  username(): string | null {
    return this.store.username();
  }

  private async proveAnd(
    password: string,
    action: (authKey: string) => Promise<unknown>,
  ): Promise<void> {
    const me = this.me ?? (await this.api.me());
    const keys = await this.crypto.deriveSubkeys(password, me.salt, me.kdf);
    try {
      await action(await this.crypto.authKeyB64(keys));
    } finally {
      await this.crypto.wipeSubkeys(keys);
    }
  }

  private handleExpiry(): void {
    if (this.store.status() === 'anonymous') return;
    this.resetTo('/login?expired=1');
  }

  private resetTo(url: string): void {
    this.me = null;
    this.bootstrapping = Promise.resolve();
    this.store.setAnonymous();
    void this.router.navigateByUrl(url);
  }
}
