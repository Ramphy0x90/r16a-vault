import type { Theme } from '../messages/schema';

/** Same attribute the web app uses. `system` removes it so the media query decides. */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
