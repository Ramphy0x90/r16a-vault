import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { Icon } from '../shared/icon';

/**
 * Copy control that confirms in place. The icon crossfades to a check with a slight blur,
 * which reads as one shape morphing rather than two icons swapping.
 */
@Component({
  selector: 'app-copy-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button
      type="button"
      class="icon-btn"
      [class.copied]="copied()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="copyRequest.emit()"
    >
      <span class="swap">
        <app-icon class="a" name="copy" [size]="16" />
        <app-icon class="b" name="check" [size]="16" [stroke]="2.25" />
      </span>
    </button>
  `,
  styles: `
    .swap {
      display: grid;
    }
    .swap > * {
      grid-area: 1 / 1;
      transition:
        opacity 180ms ease,
        transform 180ms var(--ease-out),
        filter 180ms ease;
    }
    .b {
      opacity: 0;
      transform: scale(0.6);
      filter: blur(2px);
      color: var(--color-accent);
    }
    .copied .a {
      opacity: 0;
      transform: scale(0.6);
      filter: blur(2px);
    }
    .copied .b {
      opacity: 1;
      transform: none;
      filter: none;
    }
  `,
})
export class CopyButton {
  readonly label = input.required<string>();
  readonly copied = input(false);
  readonly disabled = input(false);
  readonly copyRequest = output<void>();
}
