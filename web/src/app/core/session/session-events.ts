import { Injectable, signal } from '@angular/core';

/**
 * Breaks the dependency cycle between the HTTP interceptor and the session service. The
 * interceptor only announces expiry, the session service reacts.
 */
@Injectable({ providedIn: 'root' })
export class SessionEvents {
  readonly expiredCount = signal(0);

  expired(): void {
    this.expiredCount.update((n) => n + 1);
  }
}
