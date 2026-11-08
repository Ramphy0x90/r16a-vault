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
 * Modal on the native dialog element, which brings focus trapping, Escape to close and an
 * inert background. It fades and settles in from a slightly smaller scale, centred because
 * a modal has no trigger to grow from, and leaves faster than it arrives.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <dialog
      #dlg
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="description() ? descId : null"
      [style.--dialog-width.px]="width()"
      (close)="closed.emit()"
      (cancel)="closed.emit()"
    >
      <header>
        <div class="titles">
          <h2 [id]="titleId">{{ heading() }}</h2>
          @if (description()) {
            <p [id]="descId" class="muted">{{ description() }}</p>
          }
        </div>
        <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close dialog">
          <app-icon name="x" />
        </button>
      </header>
      <div class="body"><ng-content /></div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(var(--dialog-width, 480px), calc(100vw - 24px));
      max-height: calc(100dvh - 32px);
      padding: 0;
      border: 0;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-lg);
      opacity: 0;
      transform: scale(0.97) translateY(4px);
      transition:
        opacity 140ms ease,
        transform 140ms var(--ease-out),
        overlay 140ms allow-discrete,
        display 140ms allow-discrete;
    }
    dialog[open] {
      opacity: 1;
      transform: none;
      transition-duration: 200ms;
      @starting-style {
        opacity: 0;
        transform: scale(0.97) translateY(4px);
      }
    }
    dialog::backdrop {
      background: hsl(var(--neutral-h) 20% 4% / 0);
      backdrop-filter: blur(0);
      transition:
        background-color 200ms ease,
        backdrop-filter 200ms ease,
        overlay 200ms allow-discrete,
        display 200ms allow-discrete;
    }
    dialog[open]::backdrop {
      background: hsl(var(--neutral-h) 20% 4% / 0.45);
      backdrop-filter: blur(2px);
      @starting-style {
        background: hsl(var(--neutral-h) 20% 4% / 0);
        backdrop-filter: blur(0);
      }
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
      padding: 18px 14px 0 20px;
    }
    .titles {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 4px;
    }
    .titles p {
      font-size: 13px;
    }
    .body {
      padding: 16px 20px 20px;
    }
  `,
})
export class Dialog {
  private static seq = 0;
  readonly heading = input.required<string>();
  readonly description = input('');
  readonly width = input(480);
  readonly open = input(false);
  readonly closed = output<void>();
  protected readonly titleId = `dlg-title-${Dialog.seq}`;
  protected readonly descId = `dlg-desc-${Dialog.seq++}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.open() && !el.open) el.showModal();
      if (!this.open() && el.open) el.close();
    });
  }
}
