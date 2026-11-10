import { ChangeDetectionStrategy, Component, booleanAttribute, input, signal } from '@angular/core';
import { ReactiveFormsModule, type FormControl } from '@angular/forms';

import { Icon } from '../shared/icon';

/** Master password field with a visibility toggle. Presentational, the form owns the value. */
@Component({
  selector: 'app-password-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon],
  template: `
    <div class="input-group">
      <input
        class="input"
        [class.mono]="shown()"
        [id]="inputId()"
        [type]="shown() ? 'text' : 'password'"
        [formControl]="control()"
        [attr.autocomplete]="noAutofill() ? 'new-password' : autocomplete()"
        [attr.data-1p-ignore]="noAutofill() ? '' : null"
        [attr.data-lpignore]="noAutofill() ? 'true' : null"
        [attr.data-bwignore]="noAutofill() ? 'true' : null"
        [attr.data-form-type]="noAutofill() ? 'other' : null"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-describedby]="describedBy() || null"
        autocapitalize="off"
        spellcheck="false"
      />
      <button
        type="button"
        class="icon-btn"
        [attr.aria-pressed]="shown()"
        [attr.aria-label]="shown() ? 'Hide password' : 'Show password'"
        (click)="shown.set(!shown())"
      >
        <app-icon [name]="shown() ? 'eye-off' : 'eye'" [size]="16" />
      </button>
    </div>
  `,
})
export class PasswordInput {
  readonly control = input.required<FormControl<string>>();
  readonly inputId = input.required<string>();
  readonly autocomplete = input<'current-password' | 'new-password' | 'off'>('current-password');
  /**
   * Keeps browsers and password manager extensions from filling or offering passwords here.
   * Browsers ignore autocomplete off on password fields, but they do not fill saved passwords
   * into one marked new-password. The data attributes opt out of 1Password, LastPass,
   * Bitwarden and Dashlane, which use their own detection.
   */
  readonly noAutofill = input(false, { transform: booleanAttribute });
  readonly invalid = input(false);
  readonly describedBy = input('');
  protected readonly shown = signal(false);
}
