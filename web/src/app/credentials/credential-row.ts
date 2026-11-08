import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import type { CredentialEntry } from './credentials.store';
import { hostOf } from './url';

/** One list row. Presentational, it only reports that the user picked it. */
@Component({
  selector: 'app-credential-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon],
  template: `
    <button
      type="button"
      class="row-btn"
      [class.selected]="selected()"
      [attr.aria-current]="selected() ? 'true' : null"
      [attr.aria-controls]="detailsId()"
      (click)="picked.emit()"
    >
      @if (entry().meta; as m) {
        <app-avatar [name]="m.name" [size]="32" />
        <span class="text">
          <span class="name">{{ m.name }}</span>
          <span class="sub">{{ subtitle() }}</span>
        </span>
        @if (m.hasTotp) {
          <app-icon class="totp" name="clock-hour-4" [size]="15" title="Has a one time code" />
          <span class="visually-hidden">Has a one time code</span>
        }
      } @else {
        <span class="broken"><app-icon name="alert-triangle" [size]="16" /></span>
        <span class="text">
          <span class="name">Unreadable entry</span>
          <span class="sub">Could not be decrypted, it may have been tampered with.</span>
        </span>
      }
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .row-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 52px;
      padding: 8px 10px;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color 120ms ease;
    }
    .row-btn.selected {
      background: var(--color-surface-3);
    }
    @media (hover: hover) and (pointer: fine) {
      .row-btn:hover:not(.selected) {
        background: var(--color-surface-2);
      }
    }
    .row-btn:focus-visible {
      outline-offset: -2px;
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .name,
    .sub {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name {
      font-weight: 500;
    }
    .sub {
      font-size: 12.5px;
      color: var(--color-text-muted);
    }
    .totp {
      color: var(--color-text-muted);
    }
    .broken {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 9px;
      background: var(--color-danger-soft);
      color: var(--color-danger);
    }
  `,
})
export class CredentialRow {
  readonly entry = input.required<CredentialEntry>();
  readonly selected = input(false);
  readonly detailsId = input.required<string>();
  readonly picked = output<void>();

  protected readonly subtitle = computed(() => {
    const m = this.entry().meta;
    if (!m) return '';
    return [m.username, hostOf(m.url)].filter(Boolean).join(' · ');
  });
}
