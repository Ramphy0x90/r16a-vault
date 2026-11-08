import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AutoLockService } from '../core/autolock/auto-lock.service';
import { SessionService } from '../core/session/session.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { Avatar } from '../shared/avatar';
import { Icon, type IconName } from '../shared/icon';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
}

/**
 * Frame for the unlocked area. A sidebar on wide screens, a compact top bar on narrow ones,
 * where labels stay available to screen readers. Starting the auto lock service here ties
 * it to unlocked use.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Avatar],
  template: `
    <a class="skip" href="#main">Skip to content</a>
    <div class="app">
      <aside class="side">
        <a routerLink="/vault" class="brand" aria-label="r16a vault home">
          <span class="mark"><app-icon name="shield-lock" [size]="16" [stroke]="2" /></span>
          <span class="brand-text">r16a vault</span>
        </a>
        <nav aria-label="Main">
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" ariaCurrentWhenActive="page">
              <app-icon [name]="item.icon" [size]="18" />
              <span class="nav-label">{{ item.label }}</span>
            </a>
          }
        </nav>
        <div class="account">
          <div class="who">
            <app-avatar [name]="vault.username() ?? '?'" [size]="26" />
            <span class="who-name">{{ vault.username() }}</span>
          </div>
          <button
            type="button"
            class="icon-btn"
            (click)="session.lock()"
            [attr.aria-label]="'Lock vault of ' + (vault.username() ?? '')"
            title="Lock vault"
          >
            <app-icon name="lock" />
          </button>
          <button
            type="button"
            class="icon-btn"
            (click)="session.logout()"
            aria-label="Sign out"
            title="Sign out"
          >
            <app-icon name="logout" />
          </button>
        </div>
      </aside>
      <main id="main" class="content" tabindex="-1"><router-outlet /></main>
    </div>
  `,
  styles: `
    .skip {
      position: absolute;
      left: -9999px;
    }
    .skip:focus {
      left: 16px;
      top: 8px;
      z-index: 100;
      background: var(--color-surface);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
    }
    .app {
      display: grid;
      grid-template-columns: 232px minmax(0, 1fr);
      min-height: 100dvh;
    }
    .side {
      position: sticky;
      top: 0;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: 14px 12px;
      border-right: 1px solid var(--color-border-subtle);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px;
      color: var(--color-text);
      font-weight: 600;
      letter-spacing: -0.01em;
      text-decoration: none;
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: var(--color-primary);
      color: hsl(var(--brand-h) var(--brand-s) 60%);
    }
    :host-context([data-theme='dark']) .mark {
      color: var(--brand-600);
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }
    nav a {
      display: flex;
      align-items: center;
      gap: 10px;
      height: var(--control-h);
      padding: 0 10px;
      border-radius: var(--radius-sm);
      color: var(--color-text-muted);
      font-weight: 500;
      text-decoration: none;
      transition:
        background-color 150ms ease,
        color 150ms ease;
    }
    nav a.active {
      color: var(--color-text);
      background: var(--color-surface-3);
    }
    nav a.active app-icon {
      color: var(--color-accent);
    }
    @media (hover: hover) and (pointer: fine) {
      nav a:hover:not(.active) {
        color: var(--color-text);
        background: var(--color-surface-2);
      }
    }
    .account {
      display: flex;
      align-items: center;
      gap: 2px;
      padding-top: var(--space-3);
      border-top: 1px solid var(--color-border-subtle);
    }
    .who {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      padding-left: 4px;
    }
    .who-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .content {
      min-width: 0;
      outline: none;
    }
    @media (max-width: 860px) {
      .app {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto 1fr;
      }
      .side {
        z-index: 10;
        height: auto;
        flex-direction: row;
        align-items: center;
        gap: var(--space-2);
        padding: 8px 12px;
        border-right: 0;
        border-bottom: 1px solid var(--color-border-subtle);
        background: color-mix(in srgb, var(--color-bg) 85%, transparent);
        backdrop-filter: saturate(1.4) blur(10px);
      }
      nav {
        flex-direction: row;
        justify-content: center;
      }
      nav a {
        padding: 0 12px;
      }
      .account {
        padding-top: 0;
        border-top: 0;
      }
      .who,
      .brand-text,
      .nav-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    }
  `,
})
export class Shell {
  protected readonly session = inject(SessionService);
  protected readonly vault = inject(VaultSessionStore);
  protected readonly nav: readonly NavItem[] = [
    { path: '/vault', label: 'Vault', icon: 'key' },
    { path: '/generator', label: 'Generator', icon: 'wand' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];

  constructor() {
    inject(AutoLockService);
  }
}
