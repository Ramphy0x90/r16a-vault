import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { Icon } from '../shared/icon';

/** Masked secret with reveal and copy controls. It never holds the value itself. */
@Component({
  selector: 'app-secret-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="line">
      <span class="label">{{ label() }}</span>
      <span class="value mono" [class.masked]="value() === null">{{
        value() ?? '••••••••••••'
      }}</span>
      <button
        type="button"
        class="icon-btn"
        [attr.aria-pressed]="value() !== null"
        [attr.aria-label]="(value() !== null ? 'Hide ' : 'Reveal ') + label().toLowerCase()"
        (click)="revealChange.emit()"
        [disabled]="busy()"
      >
        <app-icon [name]="value() !== null ? 'eye-off' : 'eye'" />
      </button>
      <button
        type="button"
        class="icon-btn"
        [attr.aria-label]="'Copy ' + label().toLowerCase()"
        (click)="copyRequest.emit()"
        [disabled]="busy()"
      >
        <app-icon name="copy" />
      </button>
    </div>
  `,
  styles: `
    .line {
      display: flex;
      align-items: center;
      gap: var(--space-1);
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
      word-break: break-all;
    }
    .masked {
      letter-spacing: 0.1em;
      color: var(--color-text-muted);
    }
  `,
})
export class SecretField {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
  readonly busy = input(false);
  readonly revealChange = output<void>();
  readonly copyRequest = output<void>();
}
