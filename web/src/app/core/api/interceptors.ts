import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { SessionEvents } from '../session/session-events';

/**
 * Adds the anti CSRF header the backend requires on every API call. Cross site pages
 * cannot set custom headers without a CORS preflight, which the server never grants.
 */
export const csrfHeaderInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.url.startsWith('/api/') ? req.clone({ setHeaders: { 'X-R16a-Request': '1' } }) : req);

/**
 * A dead session surfaces as the `unauthenticated` problem. Wrong password proofs use a
 * different slug and stay with the caller, so only real expiry resets the app.
 */
export const sessionExpiryInterceptor: HttpInterceptorFn = (req, next) => {
  const events = inject(SessionEvents);
  return next(req).pipe(
    catchError((e: unknown) => {
      if (e instanceof HttpErrorResponse && e.status === 401) {
        const type = (e.error as { type?: unknown } | null)?.type;
        if (type === 'urn:r16a:problem:unauthenticated' && !req.url.endsWith('/auth/logout'))
          events.expired();
      }
      return throwError(() => e);
    }),
  );
};
