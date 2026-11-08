import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AutoLockService } from '../core/autolock/auto-lock.service';
import { SessionService } from '../core/session/session.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { Icon } from '../shared/icon';

/** Frame for the unlocked area. Starting the auto lock service here ties it to unlocked use. */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <a class="skip" href="#main">Skip to content</a>
    <header class="bar">
      <div class="inner">
        <a routerLink="/vault" class="brand" aria-label="r16a vault home"
          ><span class="mark"><app-icon name="shield" [size]="18" /></span
          ><span class="brand-text">r16a vault</span></a
        >
        <nav aria-label="Main">
          <a routerLink="/vault" routerLinkActive="active" ariaCurrentWhenActive="page"
            ><app-icon name="vault" /><span>Vault</span></a
          >
          <a routerLink="/generator" routerLinkActive="active" ariaCurrentWhenActive="page"
            ><app-icon name="dice" /><span>Generator</span></a
          >
          <a routerLink="/settings" routerLinkActive="active" ariaCurrentWhenActive="page"
            ><app-icon name="settings" /><span>Settings</span></a
          >
        </nav>
        <div class="right">
          <button
            type="button"
            class="btn btn-secondary"
            (click)="session.lock()"
            [attr.aria-label]="'Lock vault of ' + (vault.username() ?? '')"
          >
            <app-icon name="lock" /><span class="hide-sm">Lock</span>
          </button>
          <button type="button" class="icon-btn" (click)="session.logout()" aria-label="Sign out">
            <app-icon name="logout" />
          </button>
        </div>
      </div>
    </header>
    <main id="main" class="content" tabindex="-1"><router-outlet /></main>
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
      border-radius: var(--radius);
    }
    .bar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .inner {
      max-width: 960px;
      margin: 0 auto;
      padding: var(--space-2) var(--space-4);
      display: flex;
      align-items: center;
      gap: var(--space-4);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--color-text);
      text-decoration: none;
      font-weight: 700;
      min-height: var(--touch);
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--color-primary);
      color: var(--color-on-primary);
    }
    nav {
      display: flex;
      gap: var(--space-1);
      flex: 1;
    }
    nav a {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--touch);
      padding: 0 var(--space-3);
      border-radius: var(--radius);
      color: var(--color-text-muted);
      text-decoration: none;
      font-weight: 600;
    }
    nav a:hover {
      background: var(--color-surface-2);
      color: var(--color-text);
    }
    nav a.active {
      color: var(--color-primary);
      background: var(--color-primary-soft);
    }
    .right {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }
    .content {
      max-width: 960px;
      margin: 0 auto;
      padding: var(--space-5) var(--space-4) var(--space-7);
      outline: none;
    }
    @media (max-width: 640px) {
      .brand-text,
      nav a span,
      .hide-sm {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .inner {
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
      }
    }
  `,
})
export class Shell {
  protected readonly session = inject(SessionService);
  protected readonly vault = inject(VaultSessionStore);

  constructor() {
    inject(AutoLockService);
  }
}
