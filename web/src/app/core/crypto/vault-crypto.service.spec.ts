import vectors from '../../../../../shared/crypto-test-vectors.json';

import { CryptoError, loadSodium, type KdfParams } from '@zaltys/vault-core';

import { VaultCryptoService } from './vault-crypto.service';

// The protocol itself is tested against the shared vectors in packages/vault-core. These
// tests cover the Angular service that wraps it, through its public API only.
const hex = (u8: Uint8Array): string =>
  Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const kdfOf = (c: { opslimit: number; memlimit: number }): KdfParams => ({
  alg: 'argon2id13',
  ...c,
});

describe('VaultCryptoService', () => {
  const service = new VaultCryptoService();

  it('derives the vector auth key through the public API', async () => {
    const sodium = await loadSodium();
    const c = vectors.argon2id[0];
    const keys = await service.deriveSubkeys(
      c.password,
      sodium.to_base64(unhex(c.saltHex), sodium.base64_variants.ORIGINAL),
      kdfOf(c),
    );
    expect(hex(keys.authKey)).toBe(c.authKeyHex);
  }, 30_000);

  it('round trips key material and credentials', async () => {
    const vaultKey = await service.newVaultKey();
    const material = await service.createKeyMaterial('hunter2 but longer', vaultKey);
    const keys = await service.deriveSubkeys('hunter2 but longer', material.salt, material.kdf);
    expect(await service.authKeyB64(keys)).toBe(material.authKey);
    const unwrapped = await service.unwrap(keys, material.wrappedVaultKey);
    expect(hex(unwrapped)).toBe(hex(vaultKey));

    const id = crypto.randomUUID();
    const sealed = await service.sealCredential(
      vaultKey,
      id,
      { name: 'n', url: null, username: 'u', hasTotp: true },
      { password: 'p', mfaSecret: 'JBSWY3DPEHPK3PXP' },
    );
    expect(await service.openMeta(vaultKey, id, sealed.meta)).toEqual({
      name: 'n',
      url: null,
      username: 'u',
      hasTotp: true,
    });
    expect((await service.openSecret(vaultKey, id, sealed.secret)).password).toBe('p');
    await expect(service.openSecret(vaultKey, id, sealed.meta)).rejects.toThrow(CryptoError);
    await expect(service.openMeta(vaultKey, crypto.randomUUID(), sealed.meta)).rejects.toThrow(
      CryptoError,
    );
  }, 60_000);

  it('never produces the same ciphertext twice', async () => {
    const key = await service.newVaultKey();
    const id = crypto.randomUUID();
    const a = await service.sealCredential(
      key,
      id,
      { name: 'x', url: null, username: 'y' },
      { password: 'z', mfaSecret: null },
    );
    const b = await service.sealCredential(
      key,
      id,
      { name: 'x', url: null, username: 'y' },
      { password: 'z', mfaSecret: null },
    );
    expect(a.meta).not.toBe(b.meta);
  });
});
