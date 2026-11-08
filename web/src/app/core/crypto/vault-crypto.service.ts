import { Injectable } from '@angular/core';

import { loadSodium, type Sodium } from './sodium';
import {
  CryptoError,
  DEFAULT_KDF,
  KEY_BYTES,
  SALT_BYTES,
  assertAcceptableKdf,
  credentialAad,
  encodeUtf8,
  fromBase64,
  open,
  passwordBytes,
  seal,
  splitMasterKey,
  stretch,
  toBase64,
  unwrapVaultKey,
  wrapVaultKey,
  type KdfParams,
  type Subkeys,
} from './protocol';

export interface CredentialMeta {
  readonly name: string;
  readonly url: string | null;
  readonly username: string;
  /** Lets the list offer a TOTP button without decrypting the secret blob. */
  readonly hasTotp?: boolean;
}

export interface CredentialSecret {
  readonly password: string;
  readonly mfaSecret: string | null;
}

/** Everything the server needs to create or re-key an account. The vault key never leaves. */
export interface KeyMaterial {
  readonly authKey: string;
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly wrappedVaultKey: string;
}

export interface SealedCredential {
  readonly meta: string;
  readonly secret: string;
}

interface WorkerReply {
  readonly id: number;
  readonly key?: Uint8Array;
  readonly error?: boolean;
}

/**
 * Owns libsodium and every vault crypto operation in the web client. Callers pass and
 * receive domain values and base64 strings, raw key handling stays inside this service and
 * the vault session store.
 */
@Injectable({ providedIn: 'root' })
export class VaultCryptoService {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, (reply: WorkerReply) => void>();

  sodium(): Promise<Sodium> {
    return loadSodium();
  }

  /** Stretches the password and splits it into the auth and wrap keys. */
  async deriveSubkeys(password: string, saltB64: string, kdf: KdfParams): Promise<Subkeys> {
    assertAcceptableKdf(kdf);
    const sodium = await loadSodium();
    const salt = fromBase64(sodium, saltB64);
    if (salt.length !== SALT_BYTES) throw new CryptoError('bad-envelope');
    const master = await this.stretchOffThread(sodium, passwordBytes(password), salt, kdf);
    return splitMasterKey(sodium, master);
  }

  async authKeyB64(subkeys: Subkeys): Promise<string> {
    return toBase64(await loadSodium(), subkeys.authKey);
  }

  /** Creates fresh key material around a vault key, used at registration and password change. */
  async createKeyMaterial(password: string, vaultKey: Uint8Array): Promise<KeyMaterial> {
    const sodium = await loadSodium();
    const salt = toBase64(sodium, sodium.randombytes_buf(SALT_BYTES));
    const keys = await this.deriveSubkeys(password, salt, DEFAULT_KDF);
    try {
      return {
        authKey: toBase64(sodium, keys.authKey),
        salt,
        kdf: DEFAULT_KDF,
        wrappedVaultKey: toBase64(sodium, wrapVaultKey(sodium, keys.wrapKey, vaultKey)),
      };
    } finally {
      this.wipe(sodium, keys);
    }
  }

  async newVaultKey(): Promise<Uint8Array> {
    return (await loadSodium()).randombytes_buf(KEY_BYTES);
  }

  async unwrap(keys: Subkeys, wrappedB64: string): Promise<Uint8Array> {
    const sodium = await loadSodium();
    return unwrapVaultKey(sodium, keys.wrapKey, fromBase64(sodium, wrappedB64));
  }

  async wipeSubkeys(keys: Subkeys): Promise<void> {
    this.wipe(await loadSodium(), keys);
  }

  async wipeKey(key: Uint8Array): Promise<void> {
    (await loadSodium()).memzero(key);
  }

  async sealCredential(
    vaultKey: Uint8Array,
    id: string,
    meta: CredentialMeta,
    secret: CredentialSecret,
  ): Promise<SealedCredential> {
    const sodium = await loadSodium();
    const metaPlain = encodeUtf8(JSON.stringify(meta));
    const secretPlain = encodeUtf8(JSON.stringify(secret));
    try {
      return {
        meta: toBase64(sodium, seal(sodium, vaultKey, metaPlain, credentialAad(id, 'meta'))),
        secret: toBase64(sodium, seal(sodium, vaultKey, secretPlain, credentialAad(id, 'secret'))),
      };
    } finally {
      sodium.memzero(metaPlain);
      sodium.memzero(secretPlain);
    }
  }

  async openMeta(vaultKey: Uint8Array, id: string, blobB64: string): Promise<CredentialMeta> {
    const value = await this.openJson(vaultKey, id, 'meta', blobB64);
    if (typeof value['name'] !== 'string' || typeof value['username'] !== 'string') {
      throw new CryptoError('decrypt-failed');
    }
    return {
      name: value['name'],
      username: value['username'],
      url: typeof value['url'] === 'string' ? value['url'] : null,
      hasTotp: value['hasTotp'] === true,
    };
  }

  async openSecret(vaultKey: Uint8Array, id: string, blobB64: string): Promise<CredentialSecret> {
    const value = await this.openJson(vaultKey, id, 'secret', blobB64);
    if (typeof value['password'] !== 'string') throw new CryptoError('decrypt-failed');
    return {
      password: value['password'],
      mfaSecret: typeof value['mfaSecret'] === 'string' ? value['mfaSecret'] : null,
    };
  }

  private async openJson(
    vaultKey: Uint8Array,
    id: string,
    field: 'meta' | 'secret',
    blobB64: string,
  ): Promise<Record<string, unknown>> {
    const sodium = await loadSodium();
    const plain = open(sodium, vaultKey, fromBase64(sodium, blobB64), credentialAad(id, field));
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CryptoError('decrypt-failed');
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      throw e instanceof CryptoError ? e : new CryptoError('decrypt-failed');
    } finally {
      sodium.memzero(plain);
    }
  }

  private wipe(sodium: Sodium, keys: Subkeys): void {
    sodium.memzero(keys.authKey);
    sodium.memzero(keys.wrapKey);
  }

  /**
   * Prefers the worker. Environments without Worker support, such as the unit test
   * runner, fall back to the main thread, which is correct but blocks the UI.
   */
  private async stretchOffThread(
    sodium: Sodium,
    password: Uint8Array,
    salt: Uint8Array,
    kdf: KdfParams,
  ): Promise<Uint8Array> {
    const worker = this.ensureWorker();
    if (!worker) {
      try {
        return stretch(sodium, password, salt, kdf);
      } finally {
        sodium.memzero(password);
      }
    }
    const id = this.nextId++;
    const reply = await new Promise<WorkerReply>((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ id, password, salt, kdf }, [password.buffer]);
    });
    if (!reply.key) throw new CryptoError('kdf-rejected');
    return reply.key;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;
    try {
      this.worker = new Worker(new URL('./pwhash.worker', import.meta.url), { type: 'module' });
    } catch {
      return null;
    }
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      this.pending.get(data.id)?.(data);
      this.pending.delete(data.id);
    };
    this.worker.onerror = () => {
      for (const resolve of this.pending.values()) resolve({ id: -1, error: true });
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }
}
