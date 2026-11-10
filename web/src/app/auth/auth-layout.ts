import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Presentational frame shared by the sign in, register and unlock pages. */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <div class="column">
        <div class="brand">Zaltys</div>
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
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
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
