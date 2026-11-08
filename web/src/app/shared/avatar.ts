import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Initial letter in a tinted circle. Favicons are never fetched, because loading them from
 * third parties would reveal which sites the user keeps in the vault.
 */
const HUES = [160, 200, 250, 290, 330, 20, 45, 100];

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[style.--avatar-h]': 'hue()' },
  template: `{{ letter() }}`,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      flex-shrink: 0;
      font-weight: 700;
      font-size: 1.05rem;
      background: hsl(var(--avatar-h) 70% 90%);
      color: hsl(var(--avatar-h) 70% 22%);
    }
    :host-context([data-theme='dark']) {
      background: hsl(var(--avatar-h) 35% 22%);
      color: hsl(var(--avatar-h) 70% 85%);
    }
    @media (prefers-color-scheme: dark) {
      :host-context(:root:not([data-theme])) {
        background: hsl(var(--avatar-h) 35% 22%);
        color: hsl(var(--avatar-h) 70% 85%);
      }
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  protected readonly letter = computed(() => [...this.name().trim()][0]?.toUpperCase() ?? '?');
  protected readonly hue = computed(() => {
    let h = 0;
    for (const ch of this.name()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    return HUES[h % HUES.length];
  });
}
