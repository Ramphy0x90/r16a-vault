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
import { Dialog } from '../shared/dialog';
import { Icon } from '../shared/icon';
import { CredentialsStore } from './credentials.store';
import { SecretField } from './secret-field';
import { TotpDisplay } from './totp-display';

export const REVEAL_MS = 30_000;
export const TOTP_VISIBLE_MS = 90_000;

/**
 * Expanded view of one credential. Decrypts the secret blob only for the action asked for,
 * keeps plaintext in component signals, and drops it on hide, on timeout, on lock and when
 * the component is destroyed by navigation or collapse.
 */
@Component({
  selector: 'app-credential-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SecretField, TotpDisplay, Icon, Dialog],
  template: `
    <div class="details stack">
      <div class="line">
        <span class="label">Username</span>
        <span class="value">{{ meta().username || '–' }}</span>
        @if (meta().username) {
          <button
            type="button"
            class="icon-btn"
            aria-label="Copy username"
            (click)="copyUsername()"
          >
            <app-icon name="copy" />
          </button>
        }
      </div>
      @if (meta().url; as url) {
        <div class="line">
          <span class="label">Website</span>
          <a class="value" [href]="url" target="_blank" rel="noopener noreferrer">{{ url }}</a>
        </div>
      }
      <app-secret-field
        label="Password"
        [value]="password()"
        [busy]="busy()"
        (revealChange)="toggleReveal()"
        (copyRequest)="copyPassword()"
      />
      @if (meta().hasTotp) {
        @if (totp(); as t) {
          <app-totp-display
            [code]="code()"
            [remaining]="remaining()"
            [period]="t.period"
            (copyRequest)="copyCode()"
            (hideRequest)="hideTotp()"
          />
        } @else {
          <div class="line">
            <span class="label">One time code</span>
            <button
              type="button"
              class="btn btn-secondary"
              (click)="showTotp()"
              [disabled]="busy()"
            >
              <app-icon name="clock" /> Show code
            </button>
          </div>
        }
      }
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <div class="actions">
        <button type="button" class="btn btn-danger-outline" (click)="confirming.set(true)">
          <app-icon name="trash" /> Delete
        </button>
      </div>
    </div>

    <app-dialog heading="Delete credential" [open]="confirming()" (closed)="confirming.set(false)">
      <div class="stack">
        <p>
          Delete <strong>{{ meta().name }}</strong
          >? This cannot be undone.
        </p>
        <div class="row end">
          <button type="button" class="btn btn-secondary" (click)="confirming.set(false)">
            Cancel
          </button>
          <button type="button" class="btn btn-danger" (click)="remove()" [disabled]="busy()">
            Delete {{ meta().name }}
          </button>
        </div>
      </div>
    </app-dialog>
  `,
  styles: `
    .details {
      padding: 0 var(--space-4) var(--space-4) calc(var(--space-4) + 40px + var(--space-3));
      gap: var(--space-2);
    }
    .line {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      min-height: var(--touch);
    }
    .label {
      width: 92px;
      flex-shrink: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-muted);
    }
    .value {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      padding-top: var(--space-2);
    }
    .end {
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    @media (max-width: 520px) {
      .details {
        padding-left: var(--space-4);
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
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const vault = inject(VaultSessionStore);
    let first = true;
    effect(() => {
      vault.lockEpoch();
      if (first) {
        first = false;
        return;
      }
      untracked(() => this.discard());
    });
    inject(DestroyRef).onDestroy(() => this.discard());
  }

  protected copyUsername(): void {
    void this.clipboard.copy(this.meta().username, 'Username', false);
  }

  protected async toggleReveal(): Promise<void> {
    if (this.password() !== null) {
      this.hidePassword();
      return;
    }
    const secret = await this.withSecret();
    if (!secret) return;
    this.password.set(secret.password);
    this.revealTimer = setTimeout(() => this.hidePassword(), REVEAL_MS);
  }

  protected async copyPassword(): Promise<void> {
    const secret = await this.withSecret();
    if (secret) await this.clipboard.copy(secret.password, 'Password');
  }

  protected async showTotp(): Promise<void> {
    const secret = await this.withSecret();
    const config = secret?.mfaSecret ? parseTotp(secret.mfaSecret) : null;
    if (!config) {
      if (secret) this.error.set('The stored one time code secret is not valid.');
      return;
    }
    this.totp.set(config);
    this.now.set(Date.now());
    this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
    this.totpTimer = setTimeout(() => this.hideTotp(), TOTP_VISIBLE_MS);
  }

  protected copyCode(): void {
    void this.clipboard.copy(this.code(), 'Code');
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

  private async withSecret(): Promise<{ password: string; mfaSecret: string | null } | null> {
    this.busy.set(true);
    this.error.set('');
    try {
      return await this.store.openSecret(this.credentialId());
    } catch {
      this.error.set('This secret could not be decrypted.');
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
  }
}
