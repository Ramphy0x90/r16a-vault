import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { messageFor } from '../core/api/api-error';
import { SessionService } from '../core/session/session.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './password-input';

@Component({
  selector: 'app-unlock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AuthLayout, PasswordInput],
  template: `
    <app-auth-layout
      heading="Unlock your vault"
      [subtitle]="'Signed in as ' + (store.username() ?? '')"
    >
      <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <!-- Lets password managers associate the master password with the right account. -->
        <input
          type="text"
          class="visually-hidden"
          autocomplete="username"
          [value]="store.username() ?? ''"
          tabindex="-1"
          aria-hidden="true"
          readonly
        />
        <div class="field">
          <label for="unlock-password">Master password</label>
          <app-password-input
            [control]="form.controls.password"
            inputId="unlock-password"
            autocomplete="current-password"
            [invalid]="!!error()"
            describedBy="unlock-err"
          />
        </div>
        @if (error()) {
          <p id="unlock-err" class="alert alert-error" role="alert">{{ error() }}</p>
        }
        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          @if (busy()) {
            <span class="spinner" aria-hidden="true"></span> Unlocking…
          } @else {
            Unlock
          }
        </button>
      </form>
      <button type="button" class="btn btn-ghost btn-block" (click)="signOut()">Sign out</button>
    </app-auth-layout>
  `,
})
export class UnlockPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly store = inject(VaultSessionStore);
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.session.unlock(this.form.getRawValue().password);
      this.form.reset();
      await this.router.navigateByUrl('/vault');
    } catch (e) {
      this.error.set(messageFor(e));
      this.form.reset();
    } finally {
      this.busy.set(false);
    }
  }

  protected signOut(): Promise<void> {
    return this.session.logout();
  }
}
