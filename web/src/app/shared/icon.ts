import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ICONS, type IconName } from './icons.generated';

export type { IconName };

/**
 * Tabler outline icons. The shapes are bound as SVG attributes from generated data, so no
 * markup string is ever parsed and the strict CSP needs no image or font sources for icons.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'icon' },
  template: `<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    [attr.width]="size()"
    [attr.height]="size()"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="stroke()"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
  >
    @for (node of nodes(); track $index) {
      <path [attr.d]="node[1]['d']" />
    }
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly stroke = input(1.75);
  protected readonly nodes = computed(() => ICONS[this.name()]);
}
