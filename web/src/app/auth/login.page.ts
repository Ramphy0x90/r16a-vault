import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { messageFor } from '../core/api/api-error';
import { ApiService } from '../core/api/api.service';
import { SessionService } from '../core/session/session.service';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './password-input';

/** Messages for the reasons the backend gives when it sends the browser back here. */
const OIDC_ERRORS: Record<string, string> = {
  'oidc-denied': 'Single sign on was cancelled.',
  'oidc-expired': 'Single sign on took too long. Please try again.',
  'oidc-browser': 'Single sign on must be finished in the same browser it started in.',
  'oidc-state': 'This sign in link was already used or is invalid. Please try again.',
  'oidc-failed': 'Single sign on could not be completed. Please try again.',
  'registration-disabled': 'No account is linked to this identity and new accounts are disabled.',
};

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, PasswordInput],
  template: `
    <app-auth-layout heading="Sign in" subtitle="Your vault is decrypted on this device only.">
      @if (notice()) {
        <p class="alert alert-warning" role="status">{{ notice() }}</p>
      }
      <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="login-username">Username</label>
          <input
            id="login-username"
            class="input"
            formControlName="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            [attr.aria-invalid]="showErrors() && form.controls.username.invalid ? 'true' : null"
            aria-describedby="login-username-err"
          />
          @if (showErrors() && form.controls.username.invalid) {
            <span id="login-username-err" class="error-text">Enter your username.</span>
          }
        </div>
        <div class="field">
          <label for="login-password">Master password</label>
          <app-password-input
            [control]="form.controls.password"
            inputId="login-password"
            autocomplete="current-password"
            [invalid]="showErrors() && form.controls.password.invalid"
            describedBy="login-password-err"
          />
          @if (showErrors() && form.controls.password.invalid) {
            <span id="login-password-err" class="error-text">Enter your master password.</span>
          }
        </div>
        @if (error()) {
          <p class="alert alert-error" role="alert">{{ error() }}</p>
        }
        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          @if (busy()) {
            <span class="spinner" aria-hidden="true"></span> Unlocking…
          } @else {
            Sign in
          }
        </button>
      </form>
      @if (oidcName()) {
        <a class="btn btn-secondary btn-block" href="/api/v1/auth/oidc/start?client=web"
          >Sign in with {{ oidcName() }}</a
        >
      }
      @if (registrationEnabled()) {
        <p class="muted">New here? <a routerLink="/register">Create an account</a></p>
      }
    </app-auth-layout>
  `,
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly showErrors = signal(false);
  protected readonly registrationEnabled = signal(true);
  protected readonly oidcName = signal('');
  protected readonly notice = signal('');

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    if (q.has('expired')) this.notice.set('Your session ended. Please sign in again.');
    if (q.has('deleted')) this.notice.set('Your account and all its data were deleted.');
    const oidcError = q.get('oidc_error');
    if (oidcError) this.notice.set(OIDC_ERRORS[oidcError] ?? OIDC_ERRORS['oidc-failed']);
    inject(ApiService)
      .authConfig()
      .then((c) => {
        this.registrationEnabled.set(c.registrationEnabled);
        this.oidcName.set(c.oidcEnabled ? (c.oidcDisplayName ?? 'single sign on') : '');
      })
      .catch(() => undefined);
  }

  protected async submit(): Promise<void> {
    this.showErrors.set(true);
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const { username, password } = this.form.getRawValue();
    try {
      await this.session.login(username, password);
      this.form.reset();
      await this.router.navigateByUrl('/vault');
    } catch (e) {
      this.error.set(messageFor(e));
      this.form.controls.password.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
