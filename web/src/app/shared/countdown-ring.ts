import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Circular countdown for TOTP codes. Movement is a CSS transition, so the global reduced
 * motion rule turns it into a once per second step without extra logic.
 */
@Component({
  selector: 'app-countdown-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
      <circle class="track" cx="18" cy="18" r="15" />
      <circle
        class="bar"
        cx="18"
        cy="18"
        r="15"
        [attr.stroke-dashoffset]="offset()"
        [class.low]="remaining() <= 5"
      />
    </svg>
    <span class="num" aria-hidden="true">{{ remaining() }}</span>
    <span class="visually-hidden">{{ remaining() }} seconds remaining</span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
    }
    svg {
      transform: rotate(-90deg);
      position: absolute;
      inset: 0;
    }
    circle {
      fill: none;
      stroke-width: 3.5;
    }
    .track {
      stroke: var(--color-border-subtle);
    }
    .bar {
      stroke: var(--color-accent);
      stroke-linecap: round;
      stroke-dasharray: 94.25;
      transition: stroke-dashoffset 1s linear;
    }
    .bar.low {
      stroke: var(--color-danger);
    }
    .num {
      font-size: 0.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class CountdownRing {
  readonly remaining = input.required<number>();
  readonly period = input.required<number>();
  /** The circumference is 2 pi r with r = 15. */
  protected readonly offset = computed(() => 94.25 * (1 - this.remaining() / this.period()));
}
