import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MIN_MASTER_PASSWORD } from '../auth/register.page';
import { PasswordInput } from '../auth/password-input';
import { messageFor } from '../core/api/api-error';
import { ApiService } from '../core/api/api.service';
import { AUTO_LOCK_CHOICES, AutoLockService } from '../core/autolock/auto-lock.service';
import { SessionService } from '../core/session/session.service';
import { ThemeService, type ThemeChoice } from '../core/theme/theme.service';
import { ToastService } from '../core/ui/toast.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { Icon, type IconName } from '../shared/icon';
import { SessionsPanel } from './sessions-panel';

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, PasswordInput, Icon, SessionsPanel],
  template: `
    <div class="page">
      <header class="page-head">
        <h1>Settings</h1>
        <p class="muted">Preferences on this device and security for your account.</p>
      </header>

      <section class="group" aria-labelledby="s-device">
        <h2 id="s-device">This device</h2>
        <div class="card">
          <div class="setting">
            <div class="text">
              <span class="name" id="theme-label">Theme</span>
              <span class="desc">Stored on this device only.</span>
            </div>
            <div class="seg" role="radiogroup" aria-labelledby="theme-label">
              @for (t of themes; track t.value) {
                <label class="seg-item" [class.on]="theme.choice() === t.value">
                  <input
                    type="radio"
                    name="theme"
                    [value]="t.value"
                    [checked]="theme.choice() === t.value"
                    (change)="theme.set(t.value)"
                  />
                  <app-icon [name]="t.icon" [size]="15" />
                  <span>{{ t.label }}</span>
                </label>
              }
            </div>
          </div>
          <div class="setting">
            <div class="text">
              <label class="name" for="autolock">Auto lock</label>
              <span class="desc" id="autolock-hint"
                >Lock after inactivity. The vault also locks a minute after this tab is
                hidden.</span
              >
            </div>
            <select
              id="autolock"
              class="input narrow"
              (change)="autoLock.setMinutes(+$any($event.target).value)"
              aria-describedby="autolock-hint"
            >
              @for (m of lockChoices; track m) {
                <option [value]="m" [selected]="m === autoLock.minutes()">
                  {{ m }} minute{{ m === 1 ? '' : 's' }}
                </option>
              }
            </select>
          </div>
        </div>
      </section>

      <section class="group" aria-labelledby="s-password">
        <h2 id="s-password">Change master password</h2>
        <form class="card form" [formGroup]="pwForm" (ngSubmit)="changePassword()" novalidate>
          <p class="desc">
            Your entries stay encrypted with the same vault key, only the key protecting it changes.
            Other sessions are signed out.
          </p>
          <input
            type="text"
            class="visually-hidden"
            autocomplete="username"
            [value]="vault.username() ?? ''"
            tabindex="-1"
            aria-hidden="true"
            readonly
          />
          <div class="field">
            <label for="cp-current">Current master password</label>
            <app-password-input
              [control]="pwForm.controls.current"
              inputId="cp-current"
              autocomplete="current-password"
            />
          </div>
          <div class="two">
            <div class="field">
              <label for="cp-next">New master password</label>
              <app-password-input
                [control]="pwForm.controls.next"
                inputId="cp-next"
                autocomplete="new-password"
                [invalid]="pwErrors() && pwForm.controls.next.invalid"
                describedBy="cp-next-err"
              />
              @if (pwErrors() && pwForm.controls.next.invalid) {
                <span id="cp-next-err" class="error-text">Use at least {{ min }} characters.</span>
              }
            </div>
            <div class="field">
              <label for="cp-confirm">Confirm new master password</label>
              <app-password-input
                [control]="pwForm.controls.confirm"
                inputId="cp-confirm"
                autocomplete="new-password"
                [invalid]="pwMismatch()"
                describedBy="cp-confirm-err"
              />
              @if (pwMismatch()) {
                <span id="cp-confirm-err" class="error-text">The passwords do not match.</span>
              }
            </div>
          </div>
          @if (pwError()) {
            <p class="alert alert-error" role="alert">
              <app-icon name="alert-circle" [size]="16" /><span>{{ pwError() }}</span>
            </p>
          }
          <div class="form-foot">
            <button class="btn btn-primary" type="submit" [disabled]="busy()">
              Change master password
            </button>
          </div>
        </form>
      </section>

      <section class="group" aria-labelledby="s-sessions">
        <h2 id="s-sessions">Sessions</h2>
        <div class="card sessions"><app-sessions-panel /></div>
        <form class="card form" [formGroup]="allForm" (ngSubmit)="logoutAll()" novalidate>
          <p class="desc">
            Sign out on every device, including this one. Confirm with your master password.
          </p>
          <div class="inline">
            <div class="field grow">
              <label for="la-password">Master password</label>
              <app-password-input
                [control]="allForm.controls.password"
                inputId="la-password"
                autocomplete="current-password"
              />
            </div>
            <button class="btn btn-secondary" type="submit" [disabled]="busy()">
              <app-icon name="devices" [size]="16" /> Sign out of all sessions
            </button>
          </div>
          @if (allError()) {
            <p class="alert alert-error" role="alert">
              <app-icon name="alert-circle" [size]="16" /><span>{{ allError() }}</span>
            </p>
          }
        </form>
      </section>

      <section class="group" aria-labelledby="s-about">
        <h2 id="s-about">About</h2>
        <div class="card about">
          <p class="desc">
            Zaltys is built on open source software. Passphrases use the EFF large wordlist by the
            Electronic Frontier Foundation, licensed under CC BY 3.0 US, with the dice numbers
            removed.
          </p>
          <ul class="links">
            <li>
              <a href="/licenses/third-party.txt" target="_blank" rel="noopener"
                >Third party licences</a
              >
            </li>
            <li>
              <a href="/licenses/eff-wordlist-CC-BY-3.0.txt" target="_blank" rel="noopener"
                >EFF wordlist attribution</a
              >
            </li>
            <li>
              <a href="/licenses/inter-OFL-1.1.txt" target="_blank" rel="noopener"
                >Inter font licence</a
              >
            </li>
            <li>
              <a href="/licenses/jetbrains-mono-OFL-1.1.txt" target="_blank" rel="noopener"
                >JetBrains Mono font licence</a
              >
            </li>
            <li>
              <a href="/licenses/tabler-icons-MIT.txt" target="_blank" rel="noopener"
                >Tabler Icons licence</a
              >
            </li>
            @if (privacyUrl()) {
              <li><a [href]="privacyUrl()" target="_blank" rel="noopener">Privacy notice</a></li>
            }
          </ul>
        </div>
      </section>

      <section class="group" aria-labelledby="s-delete">
        <h2 id="s-delete" class="danger-title">Danger zone</h2>
        <form
          class="card form danger"
          [formGroup]="delForm"
          (ngSubmit)="deleteAccount()"
          novalidate
        >
          <div class="text">
            <span class="name">Delete account</span>
            <p class="desc">
              Permanently deletes your account and every credential in it. This cannot be undone.
            </p>
          </div>
          <div class="two">
            <div class="field">
              <label for="del-username"
                >Type your username <strong class="mono">{{ vault.username() }}</strong> to
                confirm</label
              >
              <input
                id="del-username"
                class="input"
                formControlName="username"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              />
            </div>
            <div class="field">
              <label for="del-password">Master password</label>
              <app-password-input
                [control]="delForm.controls.password"
                inputId="del-password"
                autocomplete="current-password"
              />
            </div>
          </div>
          @if (delError()) {
            <p class="alert alert-error" role="alert">
              <app-icon name="alert-circle" [size]="16" /><span>{{ delError() }}</span>
            </p>
          }
          <div class="form-foot">
            <button class="btn btn-danger" type="submit" [disabled]="busy() || !canDelete()">
              <app-icon name="trash" [size]="16" /> Delete my account
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 28px;
      max-width: 760px;
      padding: 28px 32px 64px;
    }
    .page-head {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .group > h2 {
      padding-left: 2px;
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-muted);
      letter-spacing: 0;
    }
    .danger-title {
      color: var(--color-danger) !important;
    }
    .setting {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 16px 18px;
    }
    .setting + .setting {
      border-top: 1px solid var(--color-border-subtle);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font-weight: 500;
    }
    .desc {
      font-size: 13px;
      color: var(--color-text-muted);
    }
    .narrow {
      width: 160px;
      flex-shrink: 0;
    }
    .seg {
      display: inline-flex;
      flex-shrink: 0;
      padding: 3px;
      gap: 2px;
      border-radius: var(--radius-sm);
      background: var(--color-surface-3);
    }
    .seg-item {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: calc(var(--control-h) - 6px);
      padding: 0 12px;
      border-radius: 6px;
      color: var(--color-text-muted);
      font-weight: 500;
      cursor: pointer;
      transition:
        background-color 150ms ease,
        color 150ms ease;
    }
    .seg-item.on {
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-sm);
    }
    :host-context([data-theme='dark']) .seg-item.on {
      background: var(--neutral-700);
    }
    .seg-item input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }
    .seg-item:has(input:focus-visible) {
      outline: 2px solid var(--color-focus);
      outline-offset: 1px;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px;
    }
    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .inline {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    .grow {
      flex: 1;
    }
    .form-foot {
      display: flex;
      justify-content: flex-end;
    }
    .sessions {
      padding: 6px 18px;
    }
    .about {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 18px;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 13px;
    }
    .danger {
      border-color: hsl(var(--danger-h) var(--danger-s) 50% / 0.35);
    }
    @media (max-width: 860px) {
      .page {
        padding: 16px 16px 48px;
      }
    }
    @media (max-width: 600px) {
      .two {
        grid-template-columns: 1fr;
      }
      .setting,
      .inline {
        flex-direction: column;
        align-items: stretch;
      }
      .narrow {
        width: 100%;
      }
    }
  `,
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly autoLock = inject(AutoLockService);
  protected readonly vault = inject(VaultSessionStore);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(NonNullableFormBuilder);

  constructor() {
    inject(ApiService)
      .authConfig()
      .then((c) => this.privacyUrl.set(c.privacyUrl ?? ''))
      .catch(() => undefined);
  }

  protected readonly min = MIN_MASTER_PASSWORD;
  protected readonly lockChoices = AUTO_LOCK_CHOICES;
  protected readonly themes: { value: ThemeChoice; label: string; icon: IconName }[] = [
    { value: 'system', label: 'System', icon: 'device-desktop' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ];

  protected readonly busy = signal(false);
  protected readonly privacyUrl = signal('');

  protected readonly pwForm = this.fb.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, Validators.minLength(MIN_MASTER_PASSWORD)]],
    confirm: ['', Validators.required],
  });
  private readonly pwValue = toSignal(this.pwForm.valueChanges);
  protected readonly pwErrors = signal(false);
  protected readonly pwError = signal('');
  protected readonly pwMismatch = computed(() => {
    const v = this.pwValue();
    return this.pwErrors() && !!v?.confirm && v.confirm !== v.next;
  });

  protected readonly allForm = this.fb.group({ password: ['', Validators.required] });
  protected readonly allError = signal('');

  protected readonly delForm = this.fb.group({
    username: [''],
    password: ['', Validators.required],
  });
  private readonly delValue = toSignal(this.delForm.valueChanges);
  protected readonly delError = signal('');
  protected readonly canDelete = computed(() => {
    const v = this.delValue();
    return (
      !!v?.password &&
      v.username?.trim().toLowerCase() === (this.vault.username() ?? '').toLowerCase()
    );
  });

  protected async changePassword(): Promise<void> {
    this.pwErrors.set(true);
    const v = this.pwForm.getRawValue();
    if (this.pwForm.invalid || v.next !== v.confirm) return;
    await this.run(this.pwError, async () => {
      await this.session.changeMasterPassword(v.current, v.next);
      this.pwForm.reset();
      this.pwErrors.set(false);
      this.toast.show('Master password changed. Other sessions were signed out.', 'success');
    });
  }

  protected async logoutAll(): Promise<void> {
    if (this.allForm.invalid) return;
    await this.run(this.allError, () =>
      this.session.logoutAll(this.allForm.getRawValue().password),
    );
  }

  protected async deleteAccount(): Promise<void> {
    if (!this.canDelete()) return;
    await this.run(this.delError, () =>
      this.session.deleteAccount(this.delForm.getRawValue().password),
    );
  }

  private async run(
    error: ReturnType<typeof signal<string>>,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    error.set('');
    try {
      await fn();
    } catch (e) {
      error.set(messageFor(e));
    } finally {
      this.busy.set(false);
    }
  }
}
