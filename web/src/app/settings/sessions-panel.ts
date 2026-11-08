import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { messageFor } from '../core/api/api-error';
import { ApiService } from '../core/api/api.service';
import type { SessionDto } from '../core/api/api.types';
import { ToastService } from '../core/ui/toast.service';
import { Icon } from '../shared/icon';
import { describeUserAgent, relativeTime } from './user-agent';

interface SessionRow {
  readonly id: string;
  readonly current: boolean;
  readonly name: string;
  readonly mobile: boolean;
  readonly seen: string;
  readonly locked: boolean;
}

/**
 * Where the account is signed in. Lets the owner spot sessions they do not recognise and end
 * them one by one, which is also why the server keeps the user agent at all.
 */
@Component({
  selector: 'app-sessions-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="state" role="status">
          <span class="spinner" aria-hidden="true"></span> Loading sessions…
        </div>
      }
      @case ('error') {
        <div class="state" role="alert">
          <span>{{ error() }}</span>
          <button type="button" class="btn btn-secondary btn-sm" (click)="load()">Try again</button>
        </div>
      }
      @default {
        <ul class="list" aria-label="Active sessions">
          @for (s of rows(); track s.id) {
            <li class="item">
              <span class="device"
                ><app-icon [name]="s.mobile ? 'fingerprint' : 'device-desktop'" [size]="18"
              /></span>
              <span class="text">
                <span class="name">
                  {{ s.name }}
                  @if (s.current) {
                    <span class="badge">This device</span>
                  }
                </span>
                <span class="sub">
                  Active {{ s.seen }}
                  @if (s.locked) {
                    · waiting for unlock
                  }
                </span>
              </span>
              @if (!s.current) {
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  [disabled]="busy() === s.id"
                  [attr.aria-label]="'Sign out ' + s.name"
                  (click)="revoke(s)"
                >
                  <app-icon name="logout" [size]="15" /> Sign out
                </button>
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 56px;
      padding: 8px 0;
    }
    .item + .item {
      border-top: 1px solid var(--color-border-subtle);
    }
    .device {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 9px;
      background: var(--color-surface-2);
      color: var(--color-text-muted);
    }
    .text {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .name {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }
    .badge {
      padding: 1px 7px;
      border-radius: 999px;
      background: var(--color-accent-soft);
      color: var(--color-accent-soft-text);
      font-size: 11.5px;
      font-weight: 600;
    }
    .sub {
      font-size: 12.5px;
      color: var(--color-text-muted);
    }
    .state {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 13px;
    }
  `,
})
export class SessionsPanel {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly sessions = signal<readonly SessionDto[]>([]);
  protected readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly error = signal('');
  protected readonly busy = signal<string | null>(null);

  protected readonly rows = computed<SessionRow[]>(() =>
    this.sessions().map((s) => {
      const device = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        current: s.current,
        name: device.name,
        mobile: device.mobile,
        seen: s.current ? 'now' : relativeTime(s.lastSeenAt),
        locked: s.state === 'pre_auth',
      };
    }),
  );

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.sessions.set(await this.api.listSessions());
      this.state.set('ready');
    } catch (e) {
      this.error.set(messageFor(e));
      this.state.set('error');
    }
  }

  protected async revoke(s: SessionRow): Promise<void> {
    this.busy.set(s.id);
    try {
      await this.api.revokeSession(s.id);
      this.sessions.update((list) => list.filter((x) => x.id !== s.id));
      this.toast.show(`Signed out ${s.name}.`, 'success');
    } catch (e) {
      this.toast.show(messageFor(e), 'error');
    } finally {
      this.busy.set(null);
    }
  }
}
