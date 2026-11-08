import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import type { KdfParams } from '../crypto/protocol';
import { ApiError } from './api-error';
import type {
  AuthConfig,
  CredentialDto,
  LoginResponse,
  MeResponse,
  PreloginResponse,
  UnlockResponse,
} from './api.types';

const BASE = '/api/v1';

/**
 * Typed access to the backend. Every body that leaves here is either public metadata or
 * ciphertext and key proofs produced by the crypto service.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  authConfig(): Promise<AuthConfig> {
    return this.call(this.http.get<AuthConfig>(`${BASE}/auth/config`));
  }

  oidcPending(): Promise<{ suggestedUsername?: string }> {
    return this.call(this.http.get<{ suggestedUsername?: string }>(`${BASE}/auth/oidc/pending`));
  }

  prelogin(username: string): Promise<PreloginResponse> {
    return this.call(this.http.post<PreloginResponse>(`${BASE}/auth/prelogin`, { username }));
  }

  register(body: {
    username: string;
    authKey: string;
    kdf: KdfParams;
    salt: string;
    wrappedVaultKey: string;
  }): Promise<LoginResponse> {
    return this.call(
      this.http.post<LoginResponse>(`${BASE}/auth/register`, { ...body, client: 'web' }),
    );
  }

  login(username: string, authKey: string): Promise<LoginResponse> {
    return this.call(
      this.http.post<LoginResponse>(`${BASE}/auth/login`, { username, authKey, client: 'web' }),
    );
  }

  unlock(authKey: string): Promise<UnlockResponse> {
    return this.call(this.http.post<UnlockResponse>(`${BASE}/auth/unlock`, { authKey }));
  }

  logout(): Promise<unknown> {
    return this.call(this.http.post(`${BASE}/auth/logout`, null));
  }

  logoutAll(authKey: string): Promise<unknown> {
    return this.call(this.http.post(`${BASE}/auth/logout-all`, { authKey }));
  }

  me(): Promise<MeResponse> {
    return this.call(this.http.get<MeResponse>(`${BASE}/me`));
  }

  changeMasterPassword(body: {
    currentAuthKey: string;
    newAuthKey: string;
    newSalt: string;
    newKdf: KdfParams;
    newWrappedVaultKey: string;
  }): Promise<unknown> {
    return this.call(this.http.put(`${BASE}/me/master-password`, body));
  }

  deleteAccount(authKey: string): Promise<unknown> {
    return this.call(this.http.delete(`${BASE}/me`, { body: { authKey } }));
  }

  listCredentials(): Promise<CredentialDto[]> {
    return this.call(this.http.get<CredentialDto[]>(`${BASE}/credentials`));
  }

  createCredential(body: { id: string; meta: string; secret: string }): Promise<CredentialDto> {
    return this.call(this.http.post<CredentialDto>(`${BASE}/credentials`, body));
  }

  deleteCredential(id: string): Promise<unknown> {
    return this.call(this.http.delete(`${BASE}/credentials/${encodeURIComponent(id)}`));
  }
}
