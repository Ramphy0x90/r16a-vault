import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { messageFor } from '../core/api/api-error';
import { ClipboardService } from '../core/clipboard/clipboard.service';
import type { CredentialMeta } from '../core/crypto/vault-crypto.service';
import { parseTotp, secondsRemaining, totpCode, type TotpConfig } from '../core/totp/totp';
import { ToastService } from '../core/ui/toast.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { Avatar } from '../shared/avatar';
import { Dialog } from '../shared/dialog';
import { Icon } from '../shared/icon';
import { CopyButton } from './copy-button';
import { CredentialsStore } from './credentials.store';
import { SecretField } from './secret-field';
import { TotpDisplay } from './totp-display';
import { hostOf } from './url';

export const REVEAL_MS = 30_000;
export const TOTP_VISIBLE_MS = 90_000;
const COPIED_MS = 1400;

type CopyTarget = 'username' | 'password' | 'code';

/**
 * Detail panel for one credential. Decrypts the secret blob only for the action asked for,
 * keeps plaintext in component signals, and drops it on hide, on timeout, on lock and when
 * the component is destroyed by navigation or a different selection.
 */
@Component({
  selector: 'app-credential-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SecretField, TotpDisplay, Icon, Dialog, Avatar, CopyButton],
  template: `
    <header class="head">
      <app-avatar [name]="meta().name" [size]="44" />
      <div class="titles">
        <h2>{{ meta().name }}</h2>
        @if (meta().url; as url) {
          <a class="site" [href]="url" target="_blank" rel="noopener noreferrer">
            {{ host() }} <app-icon name="external-link" [size]="13" />
          </a>
        }
      </div>
      <button type="button" class="btn btn-danger-ghost btn-sm" (click)="confirming.set(true)">
        Delete
      </button>
    </header>

    <div class="fields card">
      <div class="field-row">
        <span class="label-cell">Username</span>
        <div class="value">{{ meta().username || '–' }}</div>
        <div class="actions">
          @if (meta().username) {
            <app-copy-button
              label="Copy username"
              [copied]="copied() === 'username'"
              (copyRequest)="copyUsername()"
            />
          }
        </div>
      </div>
      <div class="field-row">
        <span class="label-cell">Password</span>
        <app-secret-field
          label="Password"
          [value]="password()"
          [busy]="busy()"
          [copied]="copied() === 'password'"
          (revealChange)="toggleReveal()"
          (copyRequest)="copyPassword()"
        />
      </div>
      @if (meta().hasTotp) {
        <div class="field-row">
          <span class="label-cell">One time code</span>
          @if (totp(); as t) {
            <app-totp-display
              [code]="code()"
              [remaining]="remaining()"
              [period]="t.period"
              [copied]="copied() === 'code'"
              (copyRequest)="copyCode()"
              (hideRequest)="hideTotp()"
            />
          } @else {
            <div class="value">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                (click)="showTotp()"
                [disabled]="busy()"
              >
                Show code
              </button>
            </div>
            <div class="actions"></div>
          }
        </div>
      }
      @if (meta().url; as url) {
        <div class="field-row">
          <span class="label-cell">Website</span>
          <div class="value url">{{ url }}</div>
          <div class="actions"></div>
        </div>
      }
    </div>

    @if (error()) {
      <p class="alert alert-error" role="alert">
        <app-icon name="alert-circle" [size]="16" /><span>{{ error() }}</span>
      </p>
    }

    <p class="footnote">
      Encrypted on this device. Secrets are decrypted only while shown and hidden again after 30
      seconds.
    </p>

    <app-dialog
      heading="Delete credential?"
      [description]="'Delete ' + meta().name + '? This cannot be undone.'"
      [width]="420"
      [open]="confirming()"
      (closed)="confirming.set(false)"
    >
      <div class="confirm-actions">
        <button type="button" class="btn btn-secondary" (click)="confirming.set(false)">
          Cancel
        </button>
        <button type="button" class="btn btn-danger" (click)="remove()" [disabled]="busy()">
          Delete {{ meta().name }}
        </button>
      </div>
    </app-dialog>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .titles {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    h2 {
      font-size: 1.125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .site {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      width: fit-content;
      font-size: 13px;
      font-weight: 400;
      color: var(--color-text-muted);
    }
    .site:hover {
      color: var(--color-link);
    }
    .fields {
      margin: 0;
      padding: 4px 0;
    }
    .field-row {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      min-height: 52px;
      padding: 6px 8px 6px 16px;
    }
    .field-row + .field-row {
      border-top: 1px solid var(--color-border-subtle);
    }
    .label-cell {
      font-size: 13px;
      color: var(--color-text-muted);
    }
    .value {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .url {
      font-size: 13px;
      color: var(--color-text-muted);
    }
    .actions {
      display: flex;
      gap: 2px;
      min-width: 32px;
      justify-content: flex-end;
    }
    .footnote {
      font-size: 12px;
      color: var(--color-text-muted);
    }
    .confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    @media (max-width: 560px) {
      .field-row {
        grid-template-columns: minmax(0, 1fr) auto;
        row-gap: 2px;
      }
      .label-cell {
        grid-column: 1 / -1;
        font-size: 12px;
      }
    }
  `,
})
export class CredentialDetails {
  private readonly store = inject(CredentialsStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly toast = inject(ToastService);

  readonly credentialId = input.required<string>();
  readonly meta = input.required<CredentialMeta>();
  readonly deleted = output<void>();

  protected readonly password = signal<string | null>(null);
  protected readonly totp = signal<TotpConfig | null>(null);
  protected readonly now = signal(Date.now());
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly confirming = signal(false);
  protected readonly copied = signal<CopyTarget | null>(null);

  protected readonly host = computed(() => hostOf(this.meta().url));
  protected readonly code = computed(() => {
    const t = this.totp();
    return t ? totpCode(t, this.now()) : '';
  });
  protected readonly remaining = computed(() => {
    const t = this.totp();
    return t ? secondsRemaining(t, this.now()) : 0;
  });

  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private totpTimer: ReturnType<typeof setTimeout> | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  private readonly vault = inject(VaultSessionStore);

  constructor() {
    const vault = this.vault;
    let first = true;
    effect(() => {
      vault.lockEpoch();
      if (first) {
        first = false;
        return;
      }
      untracked(() => this.discard());
    });
    // A different selection reuses this component, so secrets of the previous item go first.
    effect(() => {
      this.credentialId();
      untracked(() => {
        this.discard();
        this.error.set('');
      });
    });
    inject(DestroyRef).onDestroy(() => this.discard());
  }

  protected async copyUsername(): Promise<void> {
    if (await this.clipboard.copy(this.meta().username, 'Username', false))
      this.flashCopied('username');
  }

  protected async toggleReveal(): Promise<void> {
    if (this.password() !== null) {
      this.hidePassword();
      return;
    }
    const secret = await this.withSecret();
    if (!secret) return;
    this.hidePassword();
    this.password.set(secret.password);
    this.revealTimer = setTimeout(() => this.hidePassword(), REVEAL_MS);
  }

  protected async copyPassword(): Promise<void> {
    const secret = await this.withSecret();
    if (secret && (await this.clipboard.copy(secret.password, 'Password')))
      this.flashCopied('password');
  }

  protected async showTotp(): Promise<void> {
    const secret = await this.withSecret();
    const config = secret?.mfaSecret ? parseTotp(secret.mfaSecret) : null;
    if (!config) {
      if (secret) this.error.set('The stored one time code secret is not valid.');
      return;
    }
    this.hideTotp();
    this.totp.set(config);
    this.now.set(Date.now());
    this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
    this.totpTimer = setTimeout(() => this.hideTotp(), TOTP_VISIBLE_MS);
  }

  protected async copyCode(): Promise<void> {
    if (await this.clipboard.copy(this.code(), 'Code')) this.flashCopied('code');
  }

  protected hideTotp(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.totpTimer) clearTimeout(this.totpTimer);
    this.ticker = null;
    this.totpTimer = null;
    this.totp.set(null);
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    try {
      const name = this.meta().name;
      await this.store.remove(this.credentialId());
      this.confirming.set(false);
      this.toast.show(`${name} was deleted.`, 'success');
      this.deleted.emit();
    } catch (e) {
      this.confirming.set(false);
      this.error.set(messageFor(e));
    } finally {
      this.busy.set(false);
    }
  }

  private flashCopied(target: CopyTarget): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copied.set(target);
    this.copiedTimer = setTimeout(() => this.copied.set(null), COPIED_MS);
  }

  /**
   * Decrypts the secret blob for the current item. Returns null when decryption fails or when
   * the selection or lock state changed while it ran, so a result never lands on the wrong
   * item or after a lock.
   */
  private async withSecret(): Promise<{ password: string; mfaSecret: string | null } | null> {
    const id = this.credentialId();
    const epoch = this.vault.lockEpoch();
    this.busy.set(true);
    this.error.set('');
    try {
      const secret = await this.store.openSecret(id);
      return id === this.credentialId() && epoch === this.vault.lockEpoch() ? secret : null;
    } catch {
      if (id === this.credentialId()) this.error.set('This secret could not be decrypted.');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private hidePassword(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
    this.password.set(null);
  }

  private discard(): void {
    this.hidePassword();
    this.hideTotp();
    this.confirming.set(false);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = null;
    this.copied.set(null);
  }
}
