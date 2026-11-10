import { browser } from 'wxt/browser';

import '../../ui/styles.css';
import './options.css';
import { normaliseServerUrl, originPattern } from '../../background/api';
import type { StateView } from '../../background/session';
import type { Settings } from '../../messages/schema';
import { field, h, mount } from '../../ui/dom';
import { messageFor, send } from '../../ui/client';
import { applyTheme } from '../../ui/theme';

/**
 * Settings page. The server origin permission is requested here, inside the click handler,
 * because both browsers grant optional permissions only during a user gesture.
 */

const app = document.getElementById('app') as HTMLElement;

function select<T extends string | number>(
  options: readonly [T, string][],
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const el = h(
    'select',
    { class: 'input' },
    ...options.map(([v, label]) => h('option', { text: label, attrs: { value: String(v) } })),
  );
  el.value = String(value);
  el.addEventListener('change', () => {
    const picked = options.find(([v]) => String(v) === el.value);
    if (picked) onChange(picked[0]);
  });
  return el;
}

function toggle(
  label: string,
  checked: boolean,
  hint: string,
  onChange: (v: boolean) => void,
): HTMLElement {
  const box = h('input', { attrs: { type: 'checkbox', checked } });
  box.addEventListener('change', () => onChange(box.checked));
  return h(
    'div',
    { class: 'stack-tight' },
    h('label', { class: 'checkbox' }, box, h('span', { text: label })),
    h('p', { class: 'hint', text: hint }),
  );
}

function copyable(label: string, value: string): HTMLElement {
  const code = h('code', { class: 'mono value', text: value });
  return h(
    'div',
    { class: 'stack-tight' },
    h('span', { class: 'label', text: label }),
    h(
      'div',
      { class: 'row' },
      code,
      h('button', {
        class: 'btn btn-secondary btn-sm',
        text: 'Copy',
        attrs: { type: 'button' },
        on: { click: () => void navigator.clipboard.writeText(value) },
      }),
    ),
  );
}

async function render(): Promise<void> {
  const [state, settings] = await Promise.all([
    send<StateView>({ type: 'state.get' }),
    send<Settings>({ type: 'settings.get' }),
  ]);
  applyTheme(settings.theme);
  const save = (patch: Partial<Settings>): void => {
    void send<Settings>({ type: 'settings.set', settings: patch }).then((s) => applyTheme(s.theme));
  };

  const status = h('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const url = h('input', {
    class: 'input',
    attrs: {
      type: 'url',
      placeholder: 'https://zaltys.app',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  url.value = state.serverUrl ?? '';
  const connect = h('button', {
    class: 'btn btn-primary',
    text: 'Connect',
    attrs: { type: 'submit' },
  });

  const serverForm = h(
    'form',
    {
      class: 'stack',
      attrs: { novalidate: true },
      on: {
        submit: (e) => {
          e.preventDefault();
          status.className = '';
          const origin = normaliseServerUrl(url.value);
          if (!origin) {
            status.className = 'alert alert-error';
            status.textContent = messageFor(new Error('invalid-server'));
            return;
          }
          // Must run synchronously inside the submit handler to count as a user gesture.
          void browser.permissions
            .request({ origins: [originPattern(origin)] })
            .then(async (granted) => {
              if (!granted) {
                status.className = 'alert alert-error';
                status.textContent = messageFor(new Error('permission-missing'));
                return;
              }
              try {
                await send({ type: 'server.set', url: origin });
                status.className = 'alert alert-ok';
                status.textContent = `Connected to ${origin}. Open Zaltys from the toolbar to sign in.`;
                url.value = origin;
              } catch (x) {
                status.className = 'alert alert-error';
                status.textContent = messageFor(x);
              }
            });
        },
      },
    },
    field(
      'Server address',
      url,
      'Your own Zaltys server. https is required, except localhost for development.',
    ),
    h('div', { class: 'row' }, connect),
    status,
  );

  const signOut =
    state.status === 'locked' || state.status === 'unlocked'
      ? h('button', {
          class: 'btn btn-secondary',
          text: `Sign out${state.username ? ` ${state.username}` : ''}`,
          attrs: { type: 'button' },
          on: { click: () => void send({ type: 'auth.logout' }).then(() => render()) },
        })
      : null;

  const extensionOrigin = new URL(browser.runtime.getURL('/')).origin;
  const redirect = browser.identity.getRedirectURL('oidc');

  mount(
    app,
    h('h1', { text: 'Zaltys settings' }),
    h('section', { class: 'card stack' }, h('h2', { text: 'Server' }), serverForm, signOut),
    h(
      'section',
      { class: 'card stack' },
      h('h2', { text: 'Security' }),
      field(
        'Lock after',
        select(
          [
            [1, '1 minute'],
            [5, '5 minutes'],
            [15, '15 minutes'],
            [30, '30 minutes'],
          ] as const,
          settings.autoLockMinutes,
          (v) => save({ autoLockMinutes: v }),
        ),
        'Also locks when your computer is idle that long, when the screen locks and when the browser closes.',
      ),
      toggle(
        'Forget the session when the browser closes',
        settings.forgetOnClose,
        'Off, restarting the browser asks only for your master password. On, it asks you to sign in again.',
        (v) => save({ forgetOnClose: v }),
      ),
      toggle(
        'Allow filling on http://localhost',
        settings.allowLoopbackHttp,
        'For local development only. Zaltys never fills other pages without https.',
        (v) => save({ allowLoopbackHttp: v }),
      ),
    ),
    h(
      'section',
      { class: 'card stack' },
      h('h2', { text: 'Appearance' }),
      field(
        'Theme',
        select(
          [
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ] as const,
          settings.theme,
          (v) => save({ theme: v }),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card stack' },
      h('h2', { text: 'For your server operator' }),
      h('p', {
        class: 'muted',
        text: 'Servers accept any Zaltys extension by default. These values are needed only when the server restricts which extensions may sign in, or for single sign on.',
      }),
      copyable('R16A_EXTENSION_ORIGINS (optional)', extensionOrigin),
      copyable('R16A_OIDC_EXTENSION_REDIRECTS (single sign on only)', redirect),
    ),
  );
}

void render().catch((e: unknown) =>
  mount(app, h('p', { class: 'alert alert-error', text: messageFor(e) })),
);
