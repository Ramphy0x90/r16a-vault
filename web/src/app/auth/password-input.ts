import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
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
        [attr.autocomplete]="autocomplete()"
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
  readonly invalid = input(false);
  readonly describedBy = input('');
  protected readonly shown = signal(false);
}
