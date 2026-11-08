import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import type { CredentialEntry } from './credentials.store';
import { hostOf } from './url';

/** One list row. Presentational, it only reports that the user wants to expand it. */
@Component({
  selector: 'app-credential-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon],
  template: `
    <button
      type="button"
      class="row-btn"
      [attr.aria-expanded]="expanded()"
      [attr.aria-controls]="detailsId()"
      (click)="toggled.emit()"
    >
      @if (entry().meta; as m) {
        <app-avatar [name]="m.name" />
        <span class="text">
          <span class="name">{{ m.name }}</span>
          <span class="sub muted">{{ subtitle() }}</span>
        </span>
        @if (m.hasTotp) {
          <span class="badge" title="Has a one time code"
            ><app-icon name="clock" [size]="14" /> 2FA</span
          >
        }
      } @else {
        <span class="broken" aria-hidden="true">!</span>
        <span class="text">
          <span class="name">Unreadable entry</span>
          <span class="sub muted"
            >This entry could not be decrypted and may have been tampered with.</span
          >
        </span>
      }
      <app-icon class="chev" name="chevron" [class.open]="expanded()" />
    </button>
  `,
  styles: `
    .row-btn {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      min-height: 64px;
      padding: var(--space-3) var(--space-4);
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: var(--radius-lg);
    }
    .row-btn:hover {
      background: var(--color-surface-2);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sub {
      font-size: 0.9rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--color-primary-soft);
      color: var(--color-primary);
    }
    .broken {
      display: inline-grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--color-danger-soft);
      color: var(--color-danger);
      font-weight: 800;
    }
    .chev {
      color: var(--color-text-muted);
      transition: transform 150ms ease;
    }
    .chev.open {
      transform: rotate(90deg);
    }
  `,
})
export class CredentialRow {
  readonly entry = input.required<CredentialEntry>();
  readonly expanded = input(false);
  readonly detailsId = input.required<string>();
  readonly toggled = output<void>();

  protected readonly subtitle = computed(() => {
    const m = this.entry().meta;
    if (!m) return '';
    return [m.username, hostOf(m.url)].filter(Boolean).join(' · ');
  });
}
