import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { GeneratedHandoff } from '../generator/generated-handoff';
import { Icon } from '../shared/icon';
import { AddCredentialDialog } from './add-credential.dialog';
import { CredentialDetails } from './credential-details';
import { CredentialRow } from './credential-row';
import { CredentialsStore } from './credentials.store';

const NARROW = '(max-width: 960px)';

/**
 * Two pane vault. The list stays put while the detail pane follows the selection, which is
 * kept in the `item` query parameter so the browser back button behaves on phones, where the
 * detail replaces the list. Only the random credential id goes in the URL, never content.
 */
@Component({
  selector: 'app-credentials-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, CredentialRow, CredentialDetails, AddCredentialDialog],
  host: { '(document:keydown)': 'onGlobalKey($event)', '(keydown)': 'onListKey($event)' },
  template: `
    @if (store.state() === 'ready' && store.entries().length === 0) {
      <div class="empty-wrap">
        <div class="empty">
          <h2>Your vault is empty</h2>
          <p class="muted">
            Add your first login. It is encrypted on this device before it is saved.
          </p>
          <button type="button" class="btn btn-primary" (click)="openAdd()">Add credential</button>
        </div>
      </div>
    } @else {
      <div class="vault" [class.has-selection]="!!selectedEntry()">
        <section class="list-pane" aria-labelledby="vault-title">
          <header class="pane-head">
            <div class="title">
              <h1 id="vault-title">Vault</h1>
              @if (store.state() === 'ready') {
                <span class="count tabular">{{ store.entries().length }}</span>
              }
            </div>
            <button type="button" class="btn btn-primary btn-sm" (click)="openAdd()">
              Add credential
            </button>
          </header>

          <div class="search input-group">
            <app-icon class="search-icon" name="search" [size]="16" />
            <label for="vault-search" class="visually-hidden">Search credentials</label>
            <input
              #search
              id="vault-search"
              class="input"
              type="search"
              placeholder="Search"
              [value]="store.query()"
              (input)="store.query.set($any($event.target).value)"
              (keydown.arrowdown)="focusRow(0, $event)"
              autocomplete="off"
            />
            <kbd aria-hidden="true">/</kbd>
          </div>

          @switch (store.state()) {
            @case ('loading') {
              <div class="state" role="status">
                <span class="spinner" aria-hidden="true"></span> Decrypting your vault…
              </div>
            }
            @case ('error') {
              <div class="state" role="alert">
                <p>{{ store.error() }}</p>
                <button type="button" class="btn btn-secondary btn-sm" (click)="store.load()">
                  Try again
                </button>
              </div>
            }
            @case ('ready') {
              @if (store.visible().length === 0) {
                <p class="state muted">No credentials match "{{ store.query() }}".</p>
              } @else {
                <ul #list class="list" aria-label="Credentials">
                  @for (e of store.visible(); track e.id) {
                    <li>
                      <app-credential-row
                        [entry]="e"
                        [selected]="selectedId() === e.id"
                        detailsId="credential-detail"
                        (picked)="select(e.id)"
                      />
                    </li>
                  }
                </ul>
              }
            }
          }
        </section>

        <section id="credential-detail" class="detail-pane" aria-label="Credential details">
          @if (selectedEntry(); as e) {
            <button type="button" class="btn btn-ghost btn-sm back" (click)="select(null)">
              <app-icon name="arrow-left" [size]="16" /> All credentials
            </button>
            @if (e.meta; as meta) {
              <app-credential-details
                [credentialId]="e.id"
                [meta]="meta"
                (deleted)="select(null)"
              />
            }
          } @else {
            <div class="placeholder">
              <p>Select a credential to see its details</p>
              <p class="keys"><kbd>/</kbd> search <kbd>↑</kbd><kbd>↓</kbd> move</p>
            </div>
          }
        </section>
      </div>
    }
    <app-add-credential-dialog
      [open]="adding()"
      [initialPassword]="prefill()"
      (closed)="closeAdd()"
      (created)="select($event)"
    />
  `,
  styles: `
    :host {
      display: block;
    }
    .vault {
      display: grid;
      grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
      min-height: 100dvh;
    }
    .list-pane {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      padding: 20px 12px 20px 16px;
      border-right: 1px solid var(--color-border-subtle);
    }
    .pane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 4px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h1 {
      font-size: 1.125rem;
    }
    .count {
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--color-surface-3);
      color: var(--color-text-muted);
      font-size: 12px;
      font-weight: 500;
    }
    .search {
      padding-left: 10px;
    }
    .search-icon {
      color: var(--color-text-muted);
    }
    .search .input {
      padding-left: 6px;
    }
    .search kbd {
      margin-right: 4px;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .state {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px 6px;
      font-size: 13px;
    }
    .detail-pane {
      min-width: 0;
      padding: 28px 32px 48px;
    }
    .detail-pane app-credential-details {
      max-width: 680px;
    }
    .back {
      display: none;
      margin: -6px 0 12px -8px;
    }
    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 100%;
      min-height: 320px;
      color: var(--color-text-muted);
      text-align: center;
    }
    .keys {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
    }
    .keys kbd + kbd {
      margin-left: -1px;
    }
    .empty-wrap {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 24px;
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      max-width: 340px;
      text-align: center;
    }
    .empty p {
      margin-bottom: 10px;
    }
    @media (max-width: 960px) {
      .vault {
        grid-template-columns: minmax(0, 1fr);
        min-height: auto;
      }
      .list-pane {
        border-right: 0;
        padding: 16px 12px;
      }
      .detail-pane {
        display: none;
        padding: 16px 16px 40px;
      }
      .has-selection .list-pane {
        display: none;
      }
      .has-selection .detail-pane {
        display: block;
      }
      .back {
        display: inline-flex;
      }
      .empty-wrap {
        min-height: 70dvh;
      }
    }
  `,
})
export class CredentialsPage {
  protected readonly store = inject(CredentialsStore);
  private readonly handoff = inject(GeneratedHandoff);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly listEl = viewChild<ElementRef<HTMLUListElement>>('list');

  protected readonly selectedId = toSignal(
    this.route.queryParamMap.pipe(map((q) => q.get('item'))),
    {
      initialValue: null,
    },
  );
  protected readonly selectedEntry = computed(() => {
    const id = this.selectedId();
    return id ? (this.store.entries().find((e) => e.id === id && e.meta) ?? null) : null;
  });
  protected readonly adding = signal(false);
  protected readonly prefill = signal<string | null>(null);

  constructor() {
    if (this.store.state() !== 'ready') void this.store.load();
    if (this.route.snapshot.queryParamMap.has('new')) {
      this.prefill.set(this.handoff.take());
      this.adding.set(true);
    }
  }

  protected select(id: string | null): void {
    // On wide screens each pick replaces the history entry, on phones it pushes one so back returns to the list.
    const narrow = typeof matchMedia === 'function' && matchMedia(NARROW).matches;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: id, new: null },
      queryParamsHandling: 'merge',
      replaceUrl: !narrow || id === null,
    });
  }

  protected openAdd(): void {
    this.prefill.set(null);
    this.adding.set(true);
  }

  protected closeAdd(): void {
    this.adding.set(false);
    this.prefill.set(null);
  }

  /** Slash or the platform search shortcut jumps to search from anywhere on the page. */
  protected onGlobalKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"], dialog');
    const isSlash = e.key === '/' && !typing;
    const isCmdK = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
    if ((isSlash || isCmdK) && !this.adding()) {
      e.preventDefault();
      this.searchInput()?.nativeElement.focus();
      this.searchInput()?.nativeElement.select();
    }
  }

  protected focusRow(index: number, e: Event): void {
    const rows = this.rowButtons();
    if (!rows.length) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(index, rows.length - 1))].focus();
  }

  /** Arrow keys move through the list and open the focused item, like a mail client. */
  protected onListKey(e: KeyboardEvent): void {
    if (!(e.target as HTMLElement | null)?.classList.contains('row-btn')) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const rows = this.rowButtons();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? rows.length - 1
          : current + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) {
      e.preventDefault();
      this.searchInput()?.nativeElement.focus();
      return;
    }
    this.focusRow(next, e);
    if (!matchMedia(NARROW).matches) rows[Math.min(next, rows.length - 1)]?.click();
  }

  private rowButtons(): HTMLButtonElement[] {
    return Array.from(
      this.listEl()?.nativeElement.querySelectorAll<HTMLButtonElement>('.row-btn') ?? [],
    );
  }
}
