import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ApiService } from '../core/api/api.service';
import type { CredentialDto } from '../core/api/api.types';
import { VaultCryptoService } from '../core/crypto/vault-crypto.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { CredentialsStore } from './credentials.store';

describe('CredentialsStore', () => {
  let crypto: VaultCryptoService;
  let vault: VaultSessionStore;
  let store: CredentialsStore;
  let respond: (rows: CredentialDto[]) => void;
  let key: Uint8Array;

  const row = async (name: string): Promise<CredentialDto> => {
    const id = globalThis.crypto.randomUUID();
    const sealed = await crypto.sealCredential(
      key,
      id,
      { name, url: null, username: 'u' },
      { password: 'p', mfaSecret: null },
    );
    return { id, ...sealed, createdAt: '', updatedAt: '' };
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: ApiService,
          useValue: {
            listCredentials: () => new Promise<CredentialDto[]>((resolve) => (respond = resolve)),
          },
        },
      ],
    });
    crypto = TestBed.inject(VaultCryptoService);
    vault = TestBed.inject(VaultSessionStore);
    store = TestBed.inject(CredentialsStore);
    key = await crypto.newVaultKey();
    vault.setUnlocked('alice', new Uint8Array(key));
    TestBed.tick();
  });

  it('decrypts the list and drops everything on lock', async () => {
    const loading = store.load();
    respond([await row('Mail')]);
    await loading;
    expect(store.entries()[0].meta?.name).toBe('Mail');
    vault.lock();
    TestBed.tick();
    expect(store.entries()).toEqual([]);
    expect(store.state()).toBe('idle');
  });

  it('discards a response that arrives after the vault locked', async () => {
    const loading = store.load();
    const rows = [await row('Mail')];
    vault.lock();
    TestBed.tick();
    respond(rows);
    await loading;
    expect(store.entries()).toEqual([]);
    expect(store.state()).toBe('idle');
  });
});
