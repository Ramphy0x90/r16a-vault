import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ToastService } from '../core/ui/toast.service';
import { Icon } from './icon';

/**
 * Compact notifications in the bottom corner. They rise in from where they rest, using a
 * transition so a burst of toasts retargets smoothly instead of restarting keyframes.
 */
@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <ol class="region" role="status" aria-live="polite" aria-label="Notifications">
      @for (t of toasts.toasts(); track t.id) {
        <li class="toast" [attr.data-kind]="t.kind">
          <app-icon
            class="kind"
            [name]="t.kind === 'error' ? 'alert-circle' : 'circle-check'"
            [size]="16"
          />
          <span class="text">{{ t.text }}</span>
          <button
            type="button"
            class="close"
            (click)="toasts.dismiss(t.id)"
            aria-label="Dismiss notification"
          >
            <app-icon name="x" [size]="14" />
          </button>
        </li>
      }
    </ol>
  `,
  styles: `
    .region {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: min(360px, calc(100vw - 32px));
      padding: 12px 10px 12px 14px;
      border-radius: var(--radius);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-lg);
      font-size: 13px;
      line-height: 1.45;
      transition:
        opacity 260ms ease,
        transform 260ms var(--ease-out);
      @starting-style {
        opacity: 0;
        transform: translateY(12px) scale(0.98);
      }
    }
    .kind {
      margin-top: 1px;
      color: var(--color-accent);
    }
    .toast[data-kind='error'] .kind {
      color: var(--color-danger);
    }
    .text {
      flex: 1;
    }
    .close {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      margin: -2px 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
    }
    @media (hover: hover) and (pointer: fine) {
      .close:hover {
        background: var(--color-surface-2);
        color: var(--color-text);
      }
    }
    @media (max-width: 640px) {
      .region {
        left: 16px;
        align-items: stretch;
      }
      .toast {
        width: auto;
      }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
}
