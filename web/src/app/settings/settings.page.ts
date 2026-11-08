import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MIN_MASTER_PASSWORD } from '../auth/register.page';
import { PasswordInput } from '../auth/password-input';
import { messageFor } from '../core/api/api-error';
import { AUTO_LOCK_CHOICES, AutoLockService } from '../core/autolock/auto-lock.service';
import { SessionService } from '../core/session/session.service';
import { ThemeService, type ThemeChoice } from '../core/theme/theme.service';
import { ToastService } from '../core/ui/toast.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, PasswordInput],
  template: `
    <div class="stack page">
      <h1>Settings</h1>

      <section class="card stack" aria-labelledby="s-appearance">
        <h2 id="s-appearance">Appearance</h2>
        <fieldset class="choices">
          <legend class="label">Theme</legend>
          @for (t of themes; track t.value) {
            <label class="checkbox">
              <input
                type="radio"
                name="theme"
                [value]="t.value"
                [checked]="theme.choice() === t.value"
                (change)="theme.set(t.value)"
              />
              {{ t.label }}
            </label>
          }
        </fieldset>
      </section>

      <section class="card stack" aria-labelledby="s-lock">
        <h2 id="s-lock">Auto lock</h2>
        <div class="field">
          <label for="autolock">Lock the vault after inactivity</label>
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
          <span id="autolock-hint" class="hint"
            >The vault also locks one minute after this tab is hidden.</span
          >
        </div>
      </section>

      <section class="card stack" aria-labelledby="s-password">
        <h2 id="s-password">Change master password</h2>
        <p class="muted">
          Your credentials stay encrypted with the same vault key, only the key that protects it
          changes. Other devices are signed out.
        </p>
        <form class="stack" [formGroup]="pwForm" (ngSubmit)="changePassword()" novalidate>
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
          @if (pwError()) {
            <p class="alert alert-error" role="alert">{{ pwError() }}</p>
          }
          <div>
            <button class="btn btn-primary" type="submit" [disabled]="busy()">
              Change master password
            </button>
          </div>
        </form>
      </section>

      <section class="card stack" aria-labelledby="s-sessions">
        <h2 id="s-sessions">Sessions</h2>
        <p class="muted">Sign out on every device, including this one.</p>
        <form class="stack" [formGroup]="allForm" (ngSubmit)="logoutAll()" novalidate>
          <div class="field">
            <label for="la-password">Master password</label>
            <app-password-input
              [control]="allForm.controls.password"
              inputId="la-password"
              autocomplete="current-password"
            />
          </div>
          @if (allError()) {
            <p class="alert alert-error" role="alert">{{ allError() }}</p>
          }
          <div>
            <button class="btn btn-secondary" type="submit" [disabled]="busy()">
              Sign out of all sessions
            </button>
          </div>
        </form>
      </section>

      <section class="card stack danger" aria-labelledby="s-delete">
        <h2 id="s-delete">Delete account</h2>
        <p class="muted">
          This permanently deletes your account and every credential in it. It cannot be undone.
        </p>
        <form class="stack" [formGroup]="delForm" (ngSubmit)="deleteAccount()" novalidate>
          <div class="field">
            <label for="del-username"
              >Type your username <strong>{{ vault.username() }}</strong> to confirm</label
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
          @if (delError()) {
            <p class="alert alert-error" role="alert">{{ delError() }}</p>
          }
          <div>
            <button class="btn btn-danger" type="submit" [disabled]="busy() || !canDelete()">
              Delete my account
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
  styles: `
    .page {
      max-width: 640px;
    }
    .choices {
      border: 0;
      padding: 0;
      margin: 0;
      display: flex;
      gap: var(--space-4);
      flex-wrap: wrap;
    }
    .narrow {
      max-width: 240px;
    }
    .danger {
      border-color: var(--color-danger);
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

  protected readonly min = MIN_MASTER_PASSWORD;
  protected readonly lockChoices = AUTO_LOCK_CHOICES;
  protected readonly themes: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: 'Match system' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected readonly busy = signal(false);

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
