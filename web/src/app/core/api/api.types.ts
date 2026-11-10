import type { KdfParams } from '@zaltys/vault-core';

export type ClientKind = 'web';

export interface PreloginResponse {
  readonly kdf: KdfParams;
  readonly salt: string;
}

export interface LoginResponse {
  readonly user: { readonly id: string; readonly username: string };
  readonly kdf: KdfParams;
  readonly salt: string;
  readonly wrappedVaultKey: string;
}

export interface UnlockResponse {
  readonly kdf: KdfParams;
  readonly salt: string;
  readonly wrappedVaultKey: string;
}

export interface MeResponse {
  readonly id: string;
  readonly username: string;
  readonly kdf: KdfParams;
  readonly salt: string;
  readonly sessionState: 'pre_auth' | 'full';
  readonly createdAt: string;
}

export interface AuthConfig {
  readonly registrationEnabled: boolean;
  readonly oidcEnabled: boolean;
  readonly oidcDisplayName?: string;
  readonly privacyUrl?: string;
}

export interface CredentialDto {
  readonly id: string;
  readonly meta: string;
  readonly secret: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionDto {
  readonly id: string;
  readonly current: boolean;
  readonly state: 'pre_auth' | 'full';
  readonly userAgent: string | null;
  /** Null for sessions created before the server recorded it. */
  readonly client: 'web' | 'mobile' | 'extension' | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}
