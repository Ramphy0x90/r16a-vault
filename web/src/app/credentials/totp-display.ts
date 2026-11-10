import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { groupCode } from '@zaltys/vault-core';
import { CountdownRing } from '../shared/countdown-ring';
import { Icon } from '../shared/icon';
import { CopyButton } from './copy-button';

/** Live one time code. Presentational, the parent drives the clock. */
@Component({
  selector: 'app-totp-display',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountdownRing, Icon, CopyButton],
  template: `
    <div class="value">
      <span class="code mono tabular" aria-live="off">{{ grouped() }}</span>
      <app-countdown-ring [remaining]="remaining()" [period]="period()" />
    </div>
    <div class="actions">
      <button
        type="button"
        class="icon-btn"
        aria-label="Hide one time code"
        (click)="hideRequest.emit()"
      >
        <app-icon name="eye-off" [size]="16" />
      </button>
      <app-copy-button
        label="Copy one time code"
        [copied]="copied()"
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
  readonly code = input.required<string>();
  readonly remaining = input.required<number>();
  readonly period = input.required<number>();
  readonly copied = input(false);
  readonly copyRequest = output<void>();
  readonly hideRequest = output<void>();
  protected readonly grouped = computed(() => groupCode(this.code()));
}
