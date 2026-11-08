import { HttpErrorResponse } from '@angular/common/http';

/** A failed API call reduced to the stable problem slug, never the raw server text. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(slug);
    this.name = 'ApiError';
  }

  static from(e: unknown): ApiError {
    if (e instanceof ApiError) return e;
    if (e instanceof HttpErrorResponse) {
      const type =
        typeof e.error === 'object' && e.error !== null
          ? (e.error as { type?: unknown }).type
          : null;
      const slug =
        typeof type === 'string'
          ? type.replace('urn:r16a:problem:', '')
          : e.status === 0
            ? 'network'
            : 'unknown';
      const retry = Number(e.headers.get('Retry-After'));
      return new ApiError(e.status, slug, Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    return new ApiError(0, 'unknown', null);
  }
}

/** Maps errors to messages a person can act on. Technical detail never reaches the screen. */
export function messageFor(e: unknown): string {
  const err = e instanceof ApiError ? e : null;
  if (err === null) {
    const code = (e as { code?: unknown } | null)?.code;
    if (code === 'kdf-rejected')
      return 'The server sent unsafe security settings, so sign in was stopped.';
    if (code === 'decrypt-failed' || code === 'bad-envelope')
      return 'Your vault data could not be decrypted.';
    return 'Something went wrong. Please try again.';
  }
  switch (err.slug) {
    case 'invalid-credentials':
      return 'The username or master password is incorrect.';
    case 'too-many-requests':
      return err.retryAfterSeconds
        ? `Too many attempts. Try again in ${formatWait(err.retryAfterSeconds)}.`
        : 'Too many attempts. Please wait a moment and try again.';
    case 'username-taken':
      return 'That username is already taken.';
    case 'invalid-username':
      return 'Usernames are 3 to 64 letters, digits, dots, hyphens or underscores.';
    case 'registration-disabled':
      return 'New accounts are disabled on this server.';
    case 'unauthenticated':
      return 'Your session has ended. Please sign in again.';
    case 'network':
      return 'The server could not be reached. Check your connection.';
    case 'credential-limit':
      return 'This vault has reached its maximum number of entries.';
    case 'payload-too-large':
    case 'blob-too-large':
      return 'This entry is too large to save.';
    default:
      return err.status >= 500
        ? 'The server had a problem. Please try again.'
        : 'The request could not be completed.';
  }
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
