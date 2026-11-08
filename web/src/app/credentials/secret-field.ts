import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { Icon } from '../shared/icon';
import { CopyButton } from './copy-button';

/** Masked secret with reveal and copy controls. It never holds the value itself. */
@Component({
  selector: 'app-secret-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, CopyButton],
  template: `
    <div class="value" [class.masked]="value() === null">
      @if (value() === null) {
        <span aria-label="Hidden">••••••••••••</span>
      } @else {
        <span class="mono revealed">{{ value() }}</span>
      }
    </div>
    <div class="actions">
      <button
        type="button"
        class="icon-btn"
        [attr.aria-pressed]="value() !== null"
        [attr.aria-label]="(value() !== null ? 'Hide ' : 'Reveal ') + label().toLowerCase()"
        [disabled]="busy()"
        (click)="revealChange.emit()"
      >
        <app-icon [name]="value() !== null ? 'eye-off' : 'eye'" [size]="16" />
      </button>
      <app-copy-button
        [label]="'Copy ' + label().toLowerCase()"
        [copied]="copied()"
        [disabled]="busy()"
        (copyRequest)="copyRequest.emit()"
      />
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .value {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .masked {
      color: var(--color-text-muted);
      letter-spacing: 0.12em;
    }
    .revealed {
      font-size: 13.5px;
    }
    .actions {
      display: flex;
      gap: 2px;
    }
  `,
})
export class SecretField {
  readonly label = input.required<string>();
  readonly value = input<string | null>(null);
  readonly busy = input(false);
  readonly copied = input(false);
  readonly revealChange = output<void>();
  readonly copyRequest = output<void>();
}
