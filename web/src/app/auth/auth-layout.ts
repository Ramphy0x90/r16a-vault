import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Icon } from '../shared/icon';

/** Presentational frame shared by the sign in, register and unlock pages. */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <main class="wrap">
      <div class="brand">
        <span class="mark"><app-icon name="shield" [size]="22" /></span> r16a vault
      </div>
      <section class="card panel" [attr.aria-labelledby]="'auth-title'">
        <h1 id="auth-title">{{ heading() }}</h1>
        @if (subtitle()) {
          <p class="muted sub">{{ subtitle() }}</p>
        }
        <ng-content />
      </section>
      <ng-content select="[footer]" />
    </main>
  `,
  styles: `
    .wrap {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-5);
      padding: var(--space-6) var(--space-4);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 700;
      letter-spacing: 0.01em;
      font-size: 1.05rem;
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--color-primary);
      color: var(--color-on-primary);
    }
    .panel {
      width: min(420px, 100%);
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      box-shadow: var(--shadow);
    }
    .sub {
      margin-top: calc(var(--space-2) * -1);
    }
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>('');
}
