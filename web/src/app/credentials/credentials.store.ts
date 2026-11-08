import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { messageFor } from '../core/api/api-error';
import { ApiService } from '../core/api/api.service';
import type { CredentialDto } from '../core/api/api.types';
import {
  VaultCryptoService,
  type CredentialMeta,
  type CredentialSecret,
} from '../core/crypto/vault-crypto.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';

export interface CredentialEntry {
  readonly id: string;
  /** Null when the row failed to decrypt, which the list shows instead of hiding it. */
  readonly meta: CredentialMeta | null;
  readonly secretBlob: string;
  readonly createdAt: string;
}

export interface NewCredential {
  readonly name: string;
  readonly url: string | null;
  readonly username: string;
  readonly password: string;
  readonly mfaSecret: string | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Decrypted credential list. Only meta blobs are opened here, secret blobs stay sealed
 * until a view asks for one. Everything is dropped when the vault locks.
 */
@Injectable({ providedIn: 'root' })
export class CredentialsStore {
  private readonly api = inject(ApiService);
  private readonly crypto = inject(VaultCryptoService);
  private readonly vault = inject(VaultSessionStore);

  readonly entries = signal<readonly CredentialEntry[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly error = signal('');
  readonly query = signal('');

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = [...this.entries()].sort((a, b) =>
      (a.meta?.name ?? '').localeCompare(b.meta?.name ?? '', undefined, { sensitivity: 'base' }),
    );
    if (!q) return list;
    return list.filter((e) => {
      const m = e.meta;
      return !!m && [m.name, m.username, m.url ?? ''].some((f) => f.toLowerCase().includes(q));
    });
  });

  constructor() {
    effect(() => {
      this.vault.lockEpoch();
      untracked(() => this.reset());
    });
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.error.set('');
    try {
      const rows = await this.api.listCredentials();
      this.entries.set(await Promise.all(rows.map((r) => this.decryptRow(r))));
      this.state.set('ready');
    } catch (e) {
      this.error.set(messageFor(e));
      this.state.set('error');
    }
  }

  async add(input: NewCredential): Promise<void> {
    const id = crypto.randomUUID();
    const meta: CredentialMeta = {
      name: input.name,
      url: input.url,
      username: input.username,
      hasTotp: !!input.mfaSecret,
    };
    const sealed = await this.vault.withKey((key) =>
      this.crypto.sealCredential(key, id, meta, {
        password: input.password,
        mfaSecret: input.mfaSecret,
      }),
    );
    const row = await this.api.createCredential({ id, ...sealed });
    this.entries.update((list) => [
      ...list,
      { id, meta, secretBlob: row.secret, createdAt: row.createdAt },
    ]);
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteCredential(id);
    this.entries.update((list) => list.filter((e) => e.id !== id));
  }

  /** Opens the secret blob for one entry. Callers must drop the result as soon as it is hidden. */
  openSecret(id: string): Promise<CredentialSecret> {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry) return Promise.reject(new Error('unknown credential'));
    return this.vault.withKey((key) => this.crypto.openSecret(key, id, entry.secretBlob));
  }

  private async decryptRow(r: CredentialDto): Promise<CredentialEntry> {
    let meta: CredentialMeta | null;
    try {
      meta = await this.vault.withKey((key) => this.crypto.openMeta(key, r.id, r.meta));
    } catch {
      meta = null;
    }
    return { id: r.id, meta, secretBlob: r.secret, createdAt: r.createdAt };
  }

  private reset(): void {
    this.entries.set([]);
    this.state.set('idle');
    this.error.set('');
    this.query.set('');
  }
}
