import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { messageFor } from '../core/api/api-error';
import { ApiService } from '../core/api/api.service';
import { SessionService } from '../core/session/session.service';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './password-input';

export const MIN_MASTER_PASSWORD = 12;
const USERNAME = /^[\p{L}\p{N}._-]{3,64}$/u;

function matchPasswords(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('password')?.value as string;
  const confirm = group.get('confirm')?.value as string;
  return pw && confirm && pw !== confirm ? { mismatch: true } : null;
}

@Component({
  selector: 'app-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, PasswordInput],
  template: `
    <app-auth-layout [heading]="oidc() ? 'Finish signing in' : 'Create your vault'">
      @if (oidc()) {
        <p class="muted">
          Your identity was confirmed. Choose a username and a master password to create your vault.
          You will need the master password every time you unlock, even when signing in with single
          sign on.
        </p>
      }
      <div class="alert alert-warning" role="note">
        <strong>Your master password cannot be recovered.</strong>
        It never leaves this device and the server cannot reset it. If you forget it, everything in
        your vault is lost for good. Write it down somewhere safe.
      </div>
      <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="reg-username">Username</label>
          <input
            id="reg-username"
            class="input"
            formControlName="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            aria-describedby="reg-username-hint reg-username-err"
            [attr.aria-invalid]="err('username') ? 'true' : null"
          />
          <span id="reg-username-hint" class="hint"
            >3 to 64 letters, digits, dots, hyphens or underscores.</span
          >
          @if (err('username')) {
            <span id="reg-username-err" class="error-text">Choose a valid username.</span>
          }
        </div>
        <div class="field">
          <label for="reg-password">Master password</label>
          <app-password-input
            [control]="form.controls.password"
            inputId="reg-password"
            autocomplete="new-password"
            [invalid]="err('password')"
            describedBy="reg-password-hint reg-password-err"
          />
          <span id="reg-password-hint" class="hint"
            >At least {{ min }} characters. A passphrase of several random words works well.</span
          >
          @if (err('password')) {
            <span id="reg-password-err" class="error-text">Use at least {{ min }} characters.</span>
          }
        </div>
        <div class="field">
          <label for="reg-confirm">Confirm master password</label>
          <app-password-input
            [control]="form.controls.confirm"
            inputId="reg-confirm"
            autocomplete="new-password"
            [invalid]="mismatch()"
            describedBy="reg-confirm-err"
          />
          @if (mismatch()) {
            <span id="reg-confirm-err" class="error-text">The passwords do not match.</span>
          }
        </div>
        <label class="checkbox">
          <input
            type="checkbox"
            formControlName="understood"
            aria-describedby="reg-understood-err"
          />
          I understand my master password cannot be recovered.
        </label>
        @if (showErrors() && !form.controls.understood.value) {
          <span id="reg-understood-err" class="error-text">Please confirm you understand.</span>
        }
        @if (error()) {
          <p class="alert alert-error" role="alert">{{ error() }}</p>
        }
        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          @if (busy()) {
            <span class="spinner" aria-hidden="true"></span> Creating vault…
          } @else {
            Create account
          }
        </button>
      </form>
      <p class="muted">Already have an account? <a routerLink="/login">Sign in</a></p>
    </app-auth-layout>
  `,
})
export class RegisterPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly min = MIN_MASTER_PASSWORD;

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      username: ['', [Validators.required, Validators.pattern(USERNAME)]],
      password: ['', [Validators.required, Validators.minLength(MIN_MASTER_PASSWORD)]],
      confirm: ['', [Validators.required]],
      understood: [false, [Validators.requiredTrue]],
    },
    { validators: matchPasswords },
  );
  private readonly value = toSignal(this.form.valueChanges);
  protected readonly busy = signal(false);
  protected readonly oidc = signal(false);
  protected readonly error = signal('');
  protected readonly showErrors = signal(false);
  protected readonly mismatch = computed(() => {
    this.value();
    return this.showErrors() && this.form.hasError('mismatch');
  });

  constructor() {
    if (inject(ActivatedRoute).snapshot.queryParamMap.has('oidc')) {
      inject(ApiService)
        .oidcPending()
        .then((p) => {
          this.oidc.set(true);
          if (p.suggestedUsername && !this.form.controls.username.value) {
            this.form.controls.username.setValue(p.suggestedUsername);
          }
        })
        .catch(() =>
          this.error.set(
            'Your single sign on session expired. Please start again from the sign in page.',
          ),
        );
    }
  }

  protected err(name: 'username' | 'password'): boolean {
    return this.showErrors() && this.form.controls[name].invalid;
  }

  protected async submit(): Promise<void> {
    this.showErrors.set(true);
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const { username, password } = this.form.getRawValue();
    try {
      await this.session.register(username.trim(), password);
      this.form.reset();
      await this.router.navigateByUrl('/vault');
    } catch (e) {
      this.error.set(messageFor(e));
    } finally {
      this.busy.set(false);
    }
  }
}
