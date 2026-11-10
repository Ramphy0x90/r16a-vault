import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { groupCode } from '@zaltys/vault-core';
import { CountdownRing } from '../shared/countdown-ring';
import { Icon } from '../shared/icon';
import { CopyButton } from './copy-button';

/**
 * One time code row that behaves like the password field. Hidden it shows dots, shown it
 * shows the live code and countdown. Presentational, the parent drives the clock and holds
 * the secret, so a hidden code is never computed here.
 */
@Component({
  selector: 'app-totp-display',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountdownRing, Icon, CopyButton],
  template: `
    <div class="value" [class.masked]="code() === null">
      @if (code() === null) {
        <span aria-label="Hidden">••• •••</span>
      } @else {
        <span class="code mono tabular" aria-live="off">{{ grouped() }}</span>
        <app-countdown-ring [remaining]="remaining()" [period]="period()" />
      }
    </div>
    <div class="actions">
      <button
        type="button"
        class="icon-btn"
        [attr.aria-pressed]="code() !== null"
        [attr.aria-label]="(code() !== null ? 'Hide' : 'Reveal') + ' one time code'"
        [disabled]="busy()"
        (click)="revealChange.emit()"
      >
        <app-icon [name]="code() !== null ? 'eye-off' : 'eye'" [size]="16" />
      </button>
      <app-copy-button
        label="Copy one time code"
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
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 32px;
    }
    .masked {
      color: var(--color-text-muted);
      letter-spacing: 0.12em;
    }
    .code {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .actions {
      display: flex;
      gap: 2px;
    }
  `,
})
export class TotpDisplay {
  readonly code = input<string | null>(null);
  readonly remaining = input(0);
  readonly period = input(30);
  readonly busy = input(false);
  readonly copied = input(false);
  readonly revealChange = output<void>();
  readonly copyRequest = output<void>();
  protected readonly grouped = computed(() => groupCode(this.code() ?? ''));
}
