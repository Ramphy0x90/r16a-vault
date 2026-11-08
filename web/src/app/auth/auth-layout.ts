import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Icon } from '../shared/icon';

/** Presentational frame shared by the sign in, register and unlock pages. */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <main class="wrap">
      <div class="column">
        <div class="brand">
          <span class="mark"><app-icon name="shield-lock" [size]="18" [stroke]="2" /></span>
          <span>r16a vault</span>
        </div>
        <section class="card panel" aria-labelledby="auth-title">
          <header>
            <h1 id="auth-title">{{ heading() }}</h1>
            @if (subtitle()) {
              <p class="muted">{{ subtitle() }}</p>
            }
          </header>
          <ng-content />
        </section>
        <footer class="foot"><ng-content select="[footer]" /></footer>
      </div>
    </main>
  `,
  styles: `
    .wrap {
      position: relative;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: var(--space-6) var(--space-4);
      overflow: hidden;
      isolation: isolate;
    }
    .wrap::before {
      content: '';
      position: absolute;
      inset: -40% -20% auto;
      height: 70%;
      z-index: -1;
      background: radial-gradient(
        closest-side,
        hsl(var(--brand-h) var(--brand-s) 45% / 0.1),
        transparent
      );
      pointer-events: none;
    }
    .column {
      width: min(380px, 100%);
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--color-primary);
      color: hsl(var(--brand-h) var(--brand-s) 60%);
    }
    :host-context([data-theme='dark']) .mark {
      color: var(--brand-600);
    }
    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: 28px;
      box-shadow: var(--shadow-sm);
    }
    header {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 4px;
    }
    h1 {
      font-size: 1.25rem;
    }
    .foot {
      text-align: center;
      font-size: 13px;
      color: var(--color-text-muted);
    }
    .foot:empty {
      display: none;
    }
    @media (max-width: 420px) {
      .panel {
        padding: 22px 18px;
      }
    }
  `,
})
export class AuthLayout {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>('');
}
