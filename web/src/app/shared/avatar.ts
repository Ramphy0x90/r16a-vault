import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Initial letter on a tinted tile. Favicons are never fetched, because loading them from
 * third parties would reveal which sites the user keeps in the vault.
 */
const HUES = [160, 200, 228, 262, 300, 340, 18, 40];

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[style.--avatar-h]': 'hue()',
    '[style.--avatar-size.px]': 'size()',
  },
  template: `{{ letter() }}`,
  styles: `
    :host {
      --avatar-bg: hsl(var(--avatar-h) 55% 94%);
      --avatar-fg: hsl(var(--avatar-h) 50% 30%);
      display: inline-grid;
      place-items: center;
      flex-shrink: 0;
      width: var(--avatar-size);
      height: var(--avatar-size);
      border-radius: calc(var(--avatar-size) * 0.28);
      background: var(--avatar-bg);
      color: var(--avatar-fg);
      box-shadow: inset 0 0 0 1px hsl(var(--avatar-h) 40% 50% / 0.12);
      font-weight: 600;
      font-size: calc(var(--avatar-size) * 0.42);
      letter-spacing: 0;
      user-select: none;
    }
    :host-context([data-theme='dark']) {
      --avatar-bg: hsl(var(--avatar-h) 28% 18%);
      --avatar-fg: hsl(var(--avatar-h) 65% 80%);
    }
    @media (prefers-color-scheme: dark) {
      :host-context(:root:not([data-theme])) {
        --avatar-bg: hsl(var(--avatar-h) 28% 18%);
        --avatar-fg: hsl(var(--avatar-h) 65% 80%);
      }
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(32);
  protected readonly letter = computed(() => [...this.name().trim()][0]?.toUpperCase() ?? '?');
  protected readonly hue = computed(() => {
    let h = 0;
    for (const ch of this.name()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
    return HUES[h % HUES.length];
  });
}
