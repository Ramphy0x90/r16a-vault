import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Circular countdown for TOTP codes. The ring drains linearly, which suits constant motion,
 * and snaps back without a transition when a new period starts, so it never visibly rewinds.
 * The global reduced motion rule turns the drain into a once per second step.
 */
@Component({
  selector: 'app-countdown-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 36 36" width="30" height="30" aria-hidden="true">
      <circle class="track" cx="18" cy="18" r="15" />
      <circle
        class="bar"
        cx="18"
        cy="18"
        r="15"
        [attr.stroke-dashoffset]="offset()"
        [class.low]="remaining() <= 5"
        [class.reset]="remaining() === period()"
      />
    </svg>
    <span class="num tabular" aria-hidden="true">{{ remaining() }}</span>
    <span class="visually-hidden">{{ remaining() }} seconds remaining</span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 30px;
      color: var(--color-text-muted);
    }
    svg {
      position: absolute;
      inset: 0;
      transform: rotate(-90deg);
    }
    circle {
      fill: none;
      stroke-width: 2.5;
    }
    .track {
      stroke: var(--color-border-subtle);
    }
    .bar {
      stroke: var(--color-accent);
      stroke-linecap: round;
      stroke-dasharray: 94.25;
      transition:
        stroke-dashoffset 1s linear,
        stroke 200ms ease;
    }
    .bar.reset {
      transition: none;
    }
    .bar.low {
      stroke: var(--color-danger);
    }
    .num {
      font-size: 10.5px;
      font-weight: 600;
    }
  `,
})
export class CountdownRing {
  readonly remaining = input.required<number>();
  readonly period = input.required<number>();
  /** The circumference is 2 pi r with r = 15. The ring empties as the code ages. */
  protected readonly offset = computed(() => 94.25 * (1 - (this.remaining() - 1) / this.period()));
}
