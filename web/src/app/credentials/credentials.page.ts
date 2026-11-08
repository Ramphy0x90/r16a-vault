import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { GeneratedHandoff } from '../generator/generated-handoff';
import { Icon } from '../shared/icon';
import { AddCredentialDialog } from './add-credential.dialog';
import { CredentialDetails } from './credential-details';
import { CredentialRow } from './credential-row';
import { CredentialsStore } from './credentials.store';

@Component({
  selector: 'app-credentials-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, CredentialRow, CredentialDetails, AddCredentialDialog],
  template: `
    <div class="stack">
      <header class="head">
        <h1>Vault</h1>
        <button type="button" class="btn btn-primary" (click)="openAdd()">
          <app-icon name="plus" /> Add credential
        </button>
      </header>

      @if (store.entries().length > 0) {
        <div class="search input-group">
          <app-icon name="search" class="search-icon" />
          <label for="vault-search" class="visually-hidden">Search credentials</label>
          <input
            id="vault-search"
            class="input"
            type="search"
            placeholder="Search by name, username or website"
            [value]="store.query()"
            (input)="store.query.set($any($event.target).value)"
            autocomplete="off"
          />
        </div>
      }

      @switch (store.state()) {
        @case ('loading') {
          <div class="card state" role="status">
            <span class="spinner" aria-hidden="true"></span> Decrypting your vault…
          </div>
        }
        @case ('error') {
          <div class="card state" role="alert">
            <p>{{ store.error() }}</p>
            <button type="button" class="btn btn-secondary" (click)="store.load()">
              Try again
            </button>
          </div>
        }
        @case ('ready') {
          @if (store.entries().length === 0) {
            <div class="card empty">
              <app-icon name="key" [size]="32" />
              <h2>Your vault is empty</h2>
              <p class="muted">
                Add your first login. It is encrypted on this device before it is saved.
              </p>
              <button type="button" class="btn btn-primary" (click)="openAdd()">
                <app-icon name="plus" /> Add credential
              </button>
            </div>
          } @else if (store.visible().length === 0) {
            <div class="card state">
              <p class="muted">No credentials match "{{ store.query() }}".</p>
            </div>
          } @else {
            <ul class="list card" aria-label="Credentials">
              @for (e of store.visible(); track e.id) {
                <li>
                  <app-credential-row
                    [entry]="e"
                    [expanded]="expanded() === e.id"
                    [detailsId]="'details-' + e.id"
                    (toggled)="toggle(e.id)"
                  />
                  @if (expanded() === e.id && e.meta) {
                    <app-credential-details
                      [id]="'details-' + e.id"
                      [credentialId]="e.id"
                      [meta]="e.meta"
                      (deleted)="expanded.set(null)"
                    />
                  }
                </li>
              }
            </ul>
          }
        }
      }
    </div>
    <app-add-credential-dialog
      [open]="adding()"
      [initialPassword]="prefill()"
      (closed)="closeAdd()"
    />
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .search {
      align-items: center;
      padding-left: var(--space-3);
    }
    .search-icon {
      color: var(--color-text-muted);
    }
    .list {
      list-style: none;
      margin: 0;
      padding: var(--space-2);
    }
    .list li + li {
      border-top: 1px solid var(--color-border-subtle);
    }
    .state {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--space-3);
      padding: var(--space-7) var(--space-5);
      color: var(--color-text-muted);
    }
    .empty h2 {
      color: var(--color-text);
    }
  `,
})
export class CredentialsPage {
  protected readonly store = inject(CredentialsStore);
  private readonly handoff = inject(GeneratedHandoff);
  protected readonly expanded = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly prefill = signal<string | null>(null);

  constructor() {
    if (this.store.state() !== 'ready') void this.store.load();
    if (inject(ActivatedRoute).snapshot.queryParamMap.has('new')) {
      this.prefill.set(this.handoff.take());
      this.adding.set(true);
    }
  }

  protected toggle(id: string): void {
    this.expanded.set(this.expanded() === id ? null : id);
  }

  protected openAdd(): void {
    this.prefill.set(null);
    this.adding.set(true);
  }

  protected closeAdd(): void {
    this.adding.set(false);
    this.prefill.set(null);
  }
}
