import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { messageFor } from '../core/api/api-error';
import { SessionService } from '../core/session/session.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './password-input';

@Component({
  selector: 'app-unlock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AuthLayout, PasswordInput, Icon, Avatar],
  template: `
    <app-auth-layout
      heading="Unlock your vault"
      subtitle="Your vault locked to keep it safe. Enter your master password to continue."
    >
      <div class="who">
        <app-avatar [name]="store.username() ?? '?'" [size]="28" />
        <span class="name">{{ store.username() }}</span>
      </div>
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
          <p id="unlock-err" class="alert alert-error" role="alert">
            <app-icon name="alert-circle" [size]="16" /><span>{{ error() }}</span>
          </p>
        }
        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          @if (busy()) {
            <span class="spinner" aria-hidden="true"></span> Unlocking…
          } @else {
            Unlock
          }
        </button>
      </form>
      <p footer>
        Not you? <button type="button" class="linkish" (click)="signOut()">Sign out</button>
      </p>
    </app-auth-layout>
  `,
  styles: `
    .who {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px 8px 8px;
      border-radius: var(--radius-sm);
      background: var(--color-surface-2);
      border: 1px solid var(--color-border-subtle);
    }
    .name {
      flex: 1;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .linkish {
      border: 0;
      padding: 0;
      background: none;
      color: var(--color-link);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
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
