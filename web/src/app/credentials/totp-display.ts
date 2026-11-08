import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { groupCode } from '../core/totp/totp';
import { CountdownRing } from '../shared/countdown-ring';
import { Icon } from '../shared/icon';

/** Shows a live one time code. Presentational, the parent drives the clock. */
@Component({
  selector: 'app-totp-display',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CountdownRing, Icon],
  template: `
    <div class="line">
      <span class="label">One time code</span>
      <span class="code mono" aria-live="off">{{ grouped() }}</span>
      <app-countdown-ring [remaining]="remaining()" [period]="period()" />
      <button
        type="button"
        class="icon-btn"
        aria-label="Copy one time code"
        (click)="copyRequest.emit()"
      >
        <app-icon name="copy" />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Hide one time code"
        (click)="hideRequest.emit()"
      >
        <app-icon name="eye-off" />
      </button>
    </div>
  `,
  styles: `
    .line {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .label {
      width: 92px;
      flex-shrink: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-muted);
    }
    .code {
      flex: 1;
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class TotpDisplay {
  readonly code = input.required<string>();
  readonly remaining = input.required<number>();
  readonly period = input.required<number>();
  readonly copyRequest = output<void>();
  readonly hideRequest = output<void>();
  protected readonly grouped = computed(() => groupCode(this.code()));
}
