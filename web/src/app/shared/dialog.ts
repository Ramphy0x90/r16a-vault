import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

import { Icon } from './icon';

/**
 * Modal built on the native dialog element, which provides focus trapping, Escape to close
 * and an inert background without extra code.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <dialog #dlg [attr.aria-labelledby]="titleId" (close)="closed.emit()" (cancel)="closed.emit()">
      <header>
        <h2 [id]="titleId">{{ heading() }}</h2>
        <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close dialog">
          <app-icon name="close" />
        </button>
      </header>
      <div class="body"><ng-content /></div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(560px, calc(100vw - 24px));
      max-height: calc(100dvh - 24px);
      padding: 0;
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow);
    }
    dialog::backdrop {
      background: hsl(var(--neutral-h) 20% 5% / 0.55);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .body {
      padding: var(--space-5);
    }
  `,
})
export class Dialog {
  private static seq = 0;
  readonly heading = input.required<string>();
  readonly open = input(false);
  readonly closed = output<void>();
  protected readonly titleId = `dlg-title-${Dialog.seq++}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.open() && !el.open) el.showModal();
      if (!this.open() && el.open) el.close();
    });
  }
}
