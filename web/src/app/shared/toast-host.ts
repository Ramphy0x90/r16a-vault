import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ToastService } from '../core/ui/toast.service';

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="region" role="status" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class]="t.kind">
          <span>{{ t.text }}</span>
          <button
            type="button"
            class="icon-btn"
            (click)="toasts.dismiss(t.id)"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .region {
      position: fixed;
      inset: auto 0 16px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      pointer-events: none;
      z-index: 50;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 520px;
      width: 100%;
      padding: 4px 4px 4px 16px;
      border-radius: var(--radius);
      background: var(--color-text);
      color: var(--color-bg);
      box-shadow: var(--shadow);
    }
    .toast span {
      flex: 1;
    }
    .toast .icon-btn {
      color: inherit;
      font-size: 1.25rem;
    }
    .toast.error {
      background: var(--color-danger);
      color: var(--color-on-danger);
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
}
