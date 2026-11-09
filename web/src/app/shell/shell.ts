import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

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
 * Frame for the unlocked area. Wide screens get a sidebar. Narrow screens get a top bar with
 * a burger button that opens the same navigation in a drawer, built on the native dialog
 * element for focus trapping, Escape to close and an inert page behind it. Starting the auto
 * lock service here ties it to unlocked use.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet, Icon, Avatar],
  template: `
    <a class="skip" href="#main">Skip to content</a>

    <ng-template #brand>
      <a routerLink="/vault" class="brand" aria-label="Zaltys home">
        <span class="mark"><app-icon name="shield-lock" [size]="16" [stroke]="2" /></span>
        <span>Zaltys</span>
      </a>
    </ng-template>

    <ng-template #navigation>
      <nav aria-label="Main">
        @for (item of nav; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active" ariaCurrentWhenActive="page">
            <app-icon [name]="item.icon" [size]="18" />
            <span>{{ item.label }}</span>
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
    </ng-template>

    <header class="topbar">
      <button
        type="button"
        class="icon-btn"
        aria-label="Open menu"
        aria-controls="nav-drawer"
        [attr.aria-expanded]="menuOpen()"
        (click)="menuOpen.set(true)"
      >
        <app-icon name="menu-2" [size]="20" />
      </button>
      <ng-container [ngTemplateOutlet]="brand" />
      <button
        type="button"
        class="icon-btn"
        (click)="session.lock()"
        [attr.aria-label]="'Lock vault of ' + (vault.username() ?? '')"
      >
        <app-icon name="lock" />
      </button>
    </header>

    <div class="app">
      <aside class="side">
        <ng-container [ngTemplateOutlet]="brand" />
        <ng-container [ngTemplateOutlet]="navigation" />
      </aside>
      <main id="main" class="content" tabindex="-1"><router-outlet /></main>
    </div>

    <dialog #drawer id="nav-drawer" class="drawer" aria-label="Menu" (close)="menuOpen.set(false)">
      <div class="drawer-inner">
        <div class="drawer-head">
          <ng-container [ngTemplateOutlet]="brand" />
          <button
            type="button"
            class="icon-btn"
            aria-label="Close menu"
            (click)="menuOpen.set(false)"
          >
            <app-icon name="x" />
          </button>
        </div>
        <ng-container [ngTemplateOutlet]="navigation" />
      </div>
    </dialog>
  `,
  styles: `
    :host {
      --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
    }
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

    .topbar {
      display: none;
    }

    /* The drawer slides in from the left on an iOS like curve and leaves a little faster. */
    .drawer {
      width: min(300px, 86vw);
      height: 100dvh;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      border-right: 1px solid var(--color-border-subtle);
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-lg);
      transform: translateX(-100%);
      transition:
        transform 200ms var(--ease-drawer),
        overlay 200ms allow-discrete,
        display 200ms allow-discrete;
    }
    .drawer[open] {
      transform: none;
      transition-duration: 300ms;
      @starting-style {
        transform: translateX(-100%);
      }
    }
    .drawer::backdrop {
      background: hsl(var(--neutral-h) 20% 4% / 0);
      transition:
        background-color 200ms ease,
        overlay 200ms allow-discrete,
        display 200ms allow-discrete;
    }
    .drawer[open]::backdrop {
      background: hsl(var(--neutral-h) 20% 4% / 0.45);
      @starting-style {
        background: hsl(var(--neutral-h) 20% 4% / 0);
      }
    }
    .drawer-inner {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      height: 100%;
      padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
    }
    .drawer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    @media (max-width: 860px) {
      .app {
        grid-template-columns: minmax(0, 1fr);
      }
      .side {
        display: none;
      }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: 6px 8px;
        padding-top: calc(6px + env(safe-area-inset-top));
        border-bottom: 1px solid var(--color-border-subtle);
        background: color-mix(in srgb, var(--color-bg) 85%, transparent);
        backdrop-filter: saturate(1.4) blur(10px);
      }
    }
  `,
})
export class Shell {
  protected readonly session = inject(SessionService);
  protected readonly vault = inject(VaultSessionStore);
  protected readonly menuOpen = signal(false);
  private readonly drawer = viewChild.required<ElementRef<HTMLDialogElement>>('drawer');
  protected readonly nav: readonly NavItem[] = [
    { path: '/vault', label: 'Vault', icon: 'key' },
    { path: '/generator', label: 'Generator', icon: 'wand' },
    { path: '/settings', label: 'Settings', icon: 'settings' },
  ];

  constructor() {
    inject(AutoLockService);

    // Escape already closes the native dialog, so the pointer only listener is wired here
    // rather than in the template, where it would look like a missing keyboard equivalent.
    afterNextRender(() =>
      this.drawer().nativeElement.addEventListener('click', (e) => this.onDrawerClick(e)),
    );

    effect(() => {
      const el = this.drawer().nativeElement;
      if (this.menuOpen() && !el.open) el.showModal();
      if (!this.menuOpen() && el.open) el.close();
    });

    // Any navigation, including picking a link in the drawer, closes it.
    const sub = inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.menuOpen.set(false));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());

    // Growing the window past the breakpoint leaves no burger to close the drawer with.
    const wide = matchMedia('(min-width: 861px)');
    const onWide = (e: MediaQueryListEvent): void => {
      if (e.matches) this.menuOpen.set(false);
    };
    wide.addEventListener('change', onWide);
    inject(DestroyRef).onDestroy(() => wide.removeEventListener('change', onWide));
  }

  /**
   * A click on the dialog element itself, not its content, is a click on the backdrop. Links
   * also close it, because choosing the page already shown triggers no navigation event.
   */
  private onDrawerClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (target === this.drawer().nativeElement || target?.closest('a')) this.menuOpen.set(false);
  }
}
