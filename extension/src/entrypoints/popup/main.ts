import { browser } from 'wxt/browser';
import {
  DEFAULT_PASSPHRASE,
  DEFAULT_RANDOM,
  MAX_LENGTH,
  MAX_WORDS,
  MIN_LENGTH,
  MIN_MASTER_PASSWORD,
  MIN_WORDS,
  generatePassphrase,
  generatePassword,
  groupCode,
  parseSite,
  parseWordlist,
  passphraseEntropy,
  passwordEntropy,
  strengthOf,
  WORDLIST_SIZE,
  type CharClass,
  type PassphraseOptions,
  type RandomOptions,
} from '@zaltys/vault-core';

import '../../ui/styles.css';
import './popup.css';
import type { FillOutcome } from '../../background/fill';
import type { StateView } from '../../background/session';
import type { ListedCredential, Revealed, VaultList } from '../../background/vault';
import type { Settings } from '../../messages/schema';
import { field, h, mount } from '../../ui/dom';
import { messageFor, send } from '../../ui/client';
import { applyTheme } from '../../ui/theme';

/**
 * The toolbar popup. It holds no keys and no secrets of its own. It asks the background for
 * what to show, and a revealed password lives here only until it is hidden, copied or the
 * popup closes (docs/EXTENSION_SPEC.md section 3).
 */

const app = document.getElementById('app') as HTMLElement;
const announcer = document.getElementById('announce') as HTMLElement;
const REVEAL_MS = 30_000;

let tabId: number | undefined;
let state: StateView;
let vault: VaultList | null = null;
let query = '';
/** Cleanup for timers owned by the current view, run on every view change. */
let teardown: (() => void)[] = [];

function announce(text: string): void {
  announcer.textContent = '';
  announcer.textContent = text;
}

function errorBox(): { el: HTMLElement; show: (e: unknown) => void; clear: () => void } {
  const el = h('p', { class: 'alert alert-error', attrs: { role: 'alert', hidden: true } });
  return {
    el,
    show: (e) => {
      el.textContent = messageFor(e);
      el.hidden = false;
    },
    clear: () => {
      el.hidden = true;
      el.textContent = '';
    },
  };
}

function input(type: string, attrs: Record<string, string | boolean> = {}): HTMLInputElement {
  return h('input', {
    class: 'input',
    attrs: { type, autocapitalize: 'off', spellcheck: 'false', ...attrs },
  });
}

/** Master password fields. Password managers, including the browser's own, are told to stay out. */
function secretInput(attrs: Record<string, string | boolean> = {}): HTMLInputElement {
  return input('password', {
    autocomplete: 'new-password',
    'data-1p-ignore': true,
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
    ...attrs,
  });
}

async function busy<T>(button: HTMLButtonElement, work: () => Promise<T>): Promise<T> {
  button.disabled = true;
  try {
    return await work();
  } finally {
    button.disabled = false;
  }
}

function header(title: string, ...actions: (HTMLElement | null)[]): HTMLElement {
  return h('header', { class: 'bar' }, h('h1', { class: 'grow', text: title }), ...actions);
}

function linkButton(
  text: string,
  onClick: () => void,
  cls = 'btn btn-ghost btn-sm',
): HTMLButtonElement {
  return h('button', { class: cls, text, attrs: { type: 'button' }, on: { click: onClick } });
}

// Copying happens here, in a focused document. The background clears the clipboard 30
// seconds later, even if the popup has closed by then.
async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    await send({ type: 'clipboard.copied' });
    announce(`${label} copied. The clipboard will be cleared in 30 seconds.`);
    flash(`${label} copied. Clears in 30 s.`);
  } catch {
    flash('Copying failed.', true);
  }
}

function flash(text: string, error = false): void {
  const el = h('p', {
    class: `toast ${error ? 'alert-error' : 'alert-ok'}`,
    text,
    attrs: { role: 'status' },
  });
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

function navigate(view: () => void): void {
  for (const fn of teardown) fn();
  teardown = [];
  view();
}

async function refreshState(): Promise<void> {
  state = await send<StateView>({ type: 'state.get' });
  vault = null;
  navigate(routeForState);
}

function routeForState(): void {
  if (state.ssoPending) return ssoRegisterView();
  switch (state.status) {
    case 'setup':
      return setupView();
    case 'anonymous':
      return loginView();
    case 'locked':
      return unlockView();
    case 'unlocked':
      return void vaultView();
  }
}

function setupView(): void {
  mount(
    app,
    header('Zaltys'),
    h(
      'div',
      { class: 'stack pad' },
      h('p', { text: 'Connect the extension to your Zaltys server to get started.' }),
      h('button', {
        class: 'btn btn-primary btn-block',
        text: 'Open settings',
        attrs: { type: 'button', 'data-autofocus': true },
        on: { click: () => void browser.runtime.openOptionsPage() },
      }),
    ),
  );
}

function loginView(): void {
  const err = errorBox();
  const username = input('text', { autocomplete: 'off', 'data-autofocus': true, required: true });
  const password = secretInput({ required: true });
  const submit = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Sign in',
    attrs: { type: 'submit' },
  });
  const form = h(
    'form',
    {
      class: 'stack pad',
      attrs: { novalidate: true },
      on: {
        submit: (e) => {
          e.preventDefault();
          err.clear();
          if (!username.value.trim() || !password.value) return;
          void busy(submit, async () => {
            try {
              await send({
                type: 'auth.login',
                username: username.value.trim(),
                password: password.value,
              });
              password.value = '';
              await refreshState();
            } catch (x) {
              err.show(x);
            }
          });
        },
      },
    },
    field('Username', username),
    field('Master password', password),
    err.el,
    submit,
  );
  const sso = state.sso
    ? h('button', {
        class: 'btn btn-secondary btn-block',
        text: `Continue with ${state.sso.displayName}`,
        attrs: { type: 'button' },
        on: {
          click: () =>
            void send<StateView>({ type: 'auth.sso' })
              .then(() => refreshState())
              .catch((x: unknown) => err.show(x)),
        },
      })
    : null;
  mount(
    app,
    header(
      'Sign in',
      linkButton('Settings', () => void browser.runtime.openOptionsPage()),
    ),
    form,
    sso ? h('div', { class: 'pad-x' }, sso) : null,
    h('p', { class: 'muted small pad', text: state.serverUrl ?? '' }),
  );
}

function ssoRegisterView(): void {
  const err = errorBox();
  const username = input('text', { autocomplete: 'off', 'data-autofocus': true });
  username.value = state.ssoPending?.suggestedUsername ?? '';
  const password = secretInput();
  const confirm = secretInput();
  const submit = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Create account',
    attrs: { type: 'submit' },
  });
  mount(
    app,
    header(
      'Choose a master password',
      linkButton('Cancel', () => void send({ type: 'auth.logout' }).then(refreshState)),
    ),
    h(
      'form',
      {
        class: 'stack pad',
        attrs: { novalidate: true },
        on: {
          submit: (e) => {
            e.preventDefault();
            err.clear();
            if (password.value.length < MIN_MASTER_PASSWORD)
              return err.show(new Error('too-short'));
            if (password.value !== confirm.value) return err.show(new Error('mismatch'));
            void busy(submit, async () => {
              try {
                await send({
                  type: 'auth.register',
                  username: username.value.trim(),
                  password: password.value,
                });
                await refreshState();
              } catch (x) {
                err.show(x);
              }
            });
          },
        },
      },
      h('p', {
        class: 'muted',
        text: 'Single sign on proves who you are, but only your master password can open the vault. It cannot be recovered.',
      }),
      field('Username', username),
      field('Master password', password, `At least ${MIN_MASTER_PASSWORD} characters.`),
      field('Confirm master password', confirm),
      err.el,
      submit,
    ),
  );
}

function unlockView(): void {
  const err = errorBox();
  const password = secretInput({ 'data-autofocus': true });
  const submit = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Unlock',
    attrs: { type: 'submit' },
  });
  mount(
    app,
    header(
      'Unlock',
      linkButton('Sign out', () => void send({ type: 'auth.logout' }).then(refreshState)),
    ),
    h(
      'form',
      {
        class: 'stack pad',
        attrs: { novalidate: true },
        on: {
          submit: (e) => {
            e.preventDefault();
            err.clear();
            if (!password.value) return;
            void busy(submit, async () => {
              try {
                await send({ type: 'auth.unlock', password: password.value });
                password.value = '';
                await refreshState();
              } catch (x) {
                err.show(x);
                if (x instanceof Error && x.message === 'unauthenticated') await refreshState();
              }
            });
          },
        },
      },
      h('p', { class: 'muted', text: state.username ? `Signed in as ${state.username}` : '' }),
      field('Master password', password),
      err.el,
      submit,
    ),
  );
}

async function loadVault(): Promise<VaultList> {
  vault ??= await send<VaultList>({ type: 'vault.list', tabId });
  return vault;
}

async function vaultView(): Promise<void> {
  const err = errorBox();
  let list: VaultList;
  try {
    list = await loadVault();
  } catch (x) {
    if (x instanceof Error && (x.message === 'locked' || x.message === 'unauthenticated'))
      return refreshState();
    mount(app, header('Zaltys'), h('div', { class: 'pad' }, err.el));
    err.show(x);
    return;
  }
  const search = input('search', {
    placeholder: 'Search',
    'aria-label': 'Search credentials',
    autocomplete: 'off',
    'data-autofocus': true,
  });
  search.value = query;
  const results = h('div', { class: 'results' });
  const render = (): void => {
    const q = query.trim().toLowerCase();
    const visible = list.items.filter(
      (c) => !q || [c.name, c.username, c.host ?? ''].some((v) => v.toLowerCase().includes(q)),
    );
    const matching = q ? [] : visible.filter((c) => c.level !== null);
    const rest = q ? visible : visible.filter((c) => c.level === null);
    results.replaceChildren(
      ...(matching.length
        ? [
            h('h2', { class: 'section', text: `For ${list.site?.host ?? 'this site'}` }),
            itemList(matching),
          ]
        : []),
      ...(rest.length
        ? [h('h2', { class: 'section', text: q ? 'Results' : 'All credentials' }), itemList(rest)]
        : []),
      ...(!visible.length
        ? [h('p', { class: 'muted pad', text: q ? 'Nothing matches.' : 'Your vault is empty.' })]
        : []),
      ...(list.broken
        ? [
            h('p', {
              class: 'alert alert-warning',
              text: `${list.broken} entries could not be decrypted.`,
            }),
          ]
        : []),
    );
  };
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  render();
  mount(
    app,
    header(
      'Zaltys',
      linkButton('Generate', () => navigate(() => generatorView(() => void vaultView()))),
      linkButton('Add', () => navigate(() => addView())),
      linkButton('Lock', () => void send({ type: 'auth.lock' }).then(refreshState)),
    ),
    h('div', { class: 'pad-x' }, search),
    results,
    h(
      'footer',
      { class: 'foot' },
      linkButton('Settings', () => void browser.runtime.openOptionsPage()),
    ),
  );
}

function itemList(items: readonly ListedCredential[]): HTMLElement {
  return h(
    'ul',
    { class: 'items' },
    ...items.map((c) =>
      h(
        'li',
        {},
        h(
          'div',
          { class: 'item' },
          h(
            'button',
            {
              class: 'item-main',
              attrs: { type: 'button', 'aria-label': `${c.name}, ${c.username || 'no username'}` },
              on: { click: () => navigate(() => detailView(c)) },
            },
            h('span', { class: 'name', text: c.name }),
            h('span', { class: 'sub', text: c.username || c.host || '' }),
          ),
          c.level && tabId !== undefined
            ? h('button', {
                class: 'btn btn-secondary btn-sm',
                text: 'Fill',
                attrs: { type: 'button', 'aria-label': `Fill ${c.name}` },
                on: { click: () => void doFill(c, false) },
              })
            : null,
        ),
      ),
    ),
  );
}

async function doFill(c: ListedCredential, confirmCrossSite: boolean): Promise<void> {
  if (tabId === undefined) return;
  try {
    const out = await send<FillOutcome>({
      type: 'fill.request',
      tabId,
      id: c.id,
      confirmCrossSite,
    });
    if (out.status === 'filled') {
      window.close();
    } else if (out.status === 'confirm-cross-site') {
      // Firefox popups cannot show modal dialogs, so the question is an inline bar.
      const bar = h(
        'div',
        {
          class: 'alert alert-warning confirm',
          attrs: { role: 'alertdialog', 'aria-label': 'Confirm fill' },
        },
        h('p', {
          text: `This login form sends your details to ${out.actionHost}, a different site than the page.`,
        }),
        h(
          'div',
          { class: 'row' },
          linkButton('Cancel', () => bar.remove()),
          linkButton(
            'Fill anyway',
            () => {
              bar.remove();
              void doFill(c, true);
            },
            'btn btn-primary btn-sm',
          ),
        ),
      );
      app.prepend(bar);
      bar.querySelector<HTMLButtonElement>('button')?.focus();
    } else {
      flash(messageFor(new Error(out.reason)), true);
    }
  } catch (x) {
    flash(messageFor(x), true);
  }
}

function detailView(c: ListedCredential): void {
  const err = errorBox();
  const passwordValue = h('span', { class: 'mono secret', text: '••••••••••' });
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hide = (): void => {
    passwordValue.textContent = '••••••••••';
    showBtn.textContent = 'Show';
    showBtn.setAttribute('aria-pressed', 'false');
    clearTimeout(hideTimer);
  };
  teardown.push(hide);
  const showBtn = h('button', {
    class: 'btn btn-ghost btn-sm',
    text: 'Show',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    on: {
      click: () => {
        if (showBtn.getAttribute('aria-pressed') === 'true') return hide();
        void send<Revealed>({ type: 'vault.reveal', id: c.id, field: 'password' })
          .then((r) => {
            if (r.field !== 'password') return;
            passwordValue.textContent = r.value;
            showBtn.textContent = 'Hide';
            showBtn.setAttribute('aria-pressed', 'true');
            hideTimer = setTimeout(hide, REVEAL_MS);
          })
          .catch((x: unknown) => err.show(x));
      },
    },
  });
  const copyPassword = (): void =>
    void send<Revealed>({ type: 'vault.reveal', id: c.id, field: 'password' })
      .then((r) => (r.field === 'password' ? copy(r.value, 'Password') : undefined))
      .catch((x: unknown) => err.show(x));

  const totpRow = c.hasTotp ? totpBlock(c, err.show) : null;
  const confirmDelete = h('button', {
    class: 'btn btn-danger btn-sm',
    text: 'Delete for good',
    attrs: { type: 'button', hidden: true },
    on: {
      click: () =>
        void send({ type: 'vault.delete', id: c.id })
          .then(() => {
            vault = null;
            navigate(() => void vaultView());
          })
          .catch((x: unknown) => err.show(x)),
    },
  });
  mount(
    app,
    header(
      c.name,
      linkButton('Back', () => navigate(() => void vaultView())),
    ),
    h(
      'div',
      { class: 'stack pad' },
      c.url ? h('p', { class: 'muted', text: c.url }) : null,
      h(
        'div',
        { class: 'card stack' },
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'label', text: 'Username' }),
            h('div', { text: c.username || 'No username' }),
          ),
          c.username
            ? linkButton(
                'Copy',
                () => void copy(c.username, 'Username'),
                'btn btn-secondary btn-sm',
              )
            : null,
        ),
        h(
          'div',
          { class: 'row' },
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'label', text: 'Password' }),
            passwordValue,
          ),
          showBtn,
          linkButton('Copy', copyPassword, 'btn btn-secondary btn-sm'),
        ),
        totpRow,
      ),
      c.level && tabId !== undefined
        ? h('button', {
            class: 'btn btn-primary btn-block',
            text: 'Fill on this page',
            attrs: { type: 'button', 'data-autofocus': true },
            on: { click: () => void doFill(c, false) },
          })
        : null,
      err.el,
      h(
        'div',
        { class: 'row' },
        h('span', {
          class: 'muted small grow',
          text: c.match === 'host' ? 'Fills on this exact host only.' : '',
        }),
        linkButton('Delete', () => {
          confirmDelete.hidden = false;
          confirmDelete.focus();
        }),
        confirmDelete,
      ),
    ),
  );
}

function totpBlock(c: ListedCredential, onError: (e: unknown) => void): HTMLElement {
  const code = h('span', { class: 'mono code', text: '··· ···' });
  const remaining = h('span', { class: 'muted small' });
  let current = '';
  let left = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const load = (): void =>
    void send<Revealed>({ type: 'vault.reveal', id: c.id, field: 'totp' })
      .then((r) => {
        if (r.field !== 'totp') return;
        current = r.code;
        left = r.remaining;
        code.textContent = groupCode(r.code);
        remaining.textContent = `${left} s`;
      })
      .catch(onError);
  timer = setInterval(() => {
    left -= 1;
    if (left <= 0) load();
    else remaining.textContent = `${left} s`;
  }, 1000);
  teardown.push(() => clearInterval(timer));
  load();
  return h(
    'div',
    { class: 'row' },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'label', text: 'One time code' }),
      h('div', { class: 'row' }, code, remaining),
    ),
    linkButton(
      'Copy',
      () => (current ? void copy(current, 'Code') : undefined),
      'btn btn-secondary btn-sm',
    ),
  );
}

async function currentSite(): Promise<{ origin: string; host: string } | null> {
  if (tabId === undefined) return null;
  try {
    const tab = await browser.tabs.get(tabId);
    const site = tab.url ? parseSite(tab.url) : null;
    return site ? { origin: site.origin, host: site.host } : null;
  } catch {
    return null;
  }
}

function addView(generated?: string): void {
  const err = errorBox();
  const name = input('text', { autocomplete: 'off', 'data-autofocus': true, maxlength: '200' });
  const url = input('text', { autocomplete: 'off', placeholder: 'example.com' });
  const username = input('text', { autocomplete: 'off' });
  const password = secretInput();
  const mfa = input('text', { autocomplete: 'off', placeholder: 'Base32 key or otpauth:// link' });
  const exact = h('input', { attrs: { type: 'checkbox' } });
  if (generated) password.value = generated;
  void currentSite().then((site) => {
    if (!site) return;
    if (!url.value) url.value = site.origin;
    if (!name.value) name.value = site.host.replace(/^www\./, '');
  });
  const submit = h('button', {
    class: 'btn btn-primary btn-block',
    text: 'Save',
    attrs: { type: 'submit' },
  });
  mount(
    app,
    header(
      'Add credential',
      linkButton('Cancel', () => navigate(() => void vaultView())),
    ),
    h(
      'form',
      {
        class: 'stack pad',
        attrs: { novalidate: true },
        on: {
          submit: (e) => {
            e.preventDefault();
            err.clear();
            if (!name.value.trim()) return name.focus();
            void busy(submit, async () => {
              try {
                await send({
                  type: 'vault.create',
                  name: name.value.trim(),
                  url: url.value.trim() || null,
                  username: username.value,
                  password: password.value,
                  mfaSecret: mfa.value.trim() || null,
                  match: exact.checked ? 'host' : 'domain',
                });
                password.value = '';
                vault = null;
                navigate(() => void vaultView());
                flash('Saved.');
              } catch (x) {
                err.show(x);
              }
            });
          },
        },
      },
      field('Name', name),
      field('Website', url),
      field('Username', username),
      h(
        'div',
        { class: 'field' },
        h('label', { text: 'Password', attrs: { for: 'add-password' } }),
        h(
          'div',
          { class: 'row' },
          Object.assign(password, { id: 'add-password' }),
          linkButton(
            'Generate',
            () => {
              const value = password.value;
              navigate(() =>
                generatorView(
                  () => addView(value),
                  (picked) => addView(picked),
                ),
              );
            },
            'btn btn-secondary btn-sm',
          ),
        ),
      ),
      field('Authenticator secret (optional)', mfa),
      h('label', { class: 'checkbox' }, exact, h('span', { text: 'Fill on this exact host only' })),
      err.el,
      submit,
    ),
  );
}

let wordlist: Promise<readonly string[]> | null = null;
function loadWordlist(): Promise<readonly string[]> {
  // The wordlist is added by a build hook (wxt.config.ts), so WXT's path types do not list it.
  const url = (browser.runtime.getURL as (path: string) => string)('/eff_large_wordlist.txt');
  wordlist ??= fetch(url)
    .then((r) => r.text())
    .then(parseWordlist);
  return wordlist;
}

/** Same options as the web generator. `onUse` hands the value back to the add form. */
function generatorView(back: () => void, onUse?: (value: string) => void): void {
  let mode: 'random' | 'passphrase' = 'random';
  let random: RandomOptions = DEFAULT_RANDOM;
  let phrase: PassphraseOptions = DEFAULT_PASSPHRASE;
  const output = h('output', { class: 'mono generated', attrs: { 'aria-live': 'polite' } });
  const strength = h('p', { class: 'muted small' });
  const controls = h('div', { class: 'stack' });

  const regenerate = async (): Promise<void> => {
    if (mode === 'random') {
      output.textContent = generatePassword(random);
      const bits = passwordEntropy(random);
      strength.textContent = `${Math.round(bits)} bits, ${strengthOf(bits)}`;
    } else {
      output.textContent = generatePassphrase(await loadWordlist(), phrase);
      const bits = passphraseEntropy(WORDLIST_SIZE, phrase);
      strength.textContent = `${Math.round(bits)} bits, ${strengthOf(bits)}`;
    }
  };

  const check = (label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const box = h('input', { attrs: { type: 'checkbox', checked } });
    box.addEventListener('change', () => {
      onChange(box.checked);
      void regenerate();
    });
    return h('label', { class: 'checkbox' }, box, h('span', { text: label }));
  };

  const renderControls = (): void => {
    if (mode === 'random') {
      const length = input('number', {
        min: String(MIN_LENGTH),
        max: String(MAX_LENGTH),
        value: String(random.length),
      });
      length.addEventListener('change', () => {
        const n = Math.min(
          MAX_LENGTH,
          Math.max(MIN_LENGTH, Number(length.value) || DEFAULT_RANDOM.length),
        );
        length.value = String(n);
        random = { ...random, length: n };
        void regenerate();
      });
      const classes: [CharClass, string][] = [
        ['upper', 'Uppercase'],
        ['lower', 'Lowercase'],
        ['digits', 'Digits'],
        ['symbols', 'Symbols'],
      ];
      controls.replaceChildren(
        field('Length', length),
        ...classes.map(([cls, label]) =>
          check(label, random.classes.includes(cls), (on) => {
            const next = on ? [...random.classes, cls] : random.classes.filter((c) => c !== cls);
            if (next.length) random = { ...random, classes: next };
            renderControls();
          }),
        ),
        check('Avoid look alike characters', random.excludeAmbiguous, (on) => {
          random = { ...random, excludeAmbiguous: on };
        }),
      );
    } else {
      const words = input('number', {
        min: String(MIN_WORDS),
        max: String(MAX_WORDS),
        value: String(phrase.words),
      });
      words.addEventListener('change', () => {
        const n = Math.min(
          MAX_WORDS,
          Math.max(MIN_WORDS, Number(words.value) || DEFAULT_PASSPHRASE.words),
        );
        words.value = String(n);
        phrase = { ...phrase, words: n };
        void regenerate();
      });
      const separator = input('text', { maxlength: '3', value: phrase.separator });
      separator.addEventListener('change', () => {
        phrase = { ...phrase, separator: separator.value };
        void regenerate();
      });
      controls.replaceChildren(
        field('Words', words),
        field('Separator', separator),
        check('Capitalise', phrase.capitalise, (on) => {
          phrase = { ...phrase, capitalise: on };
        }),
        check('Include a number', phrase.includeNumber, (on) => {
          phrase = { ...phrase, includeNumber: on };
        }),
      );
    }
  };

  const tabs = h(
    'div',
    { class: 'segmented', attrs: { role: 'group', 'aria-label': 'Generator mode' } },
    ...(['random', 'passphrase'] as const).map((m) =>
      h('button', {
        text: m === 'random' ? 'Password' : 'Passphrase',
        attrs: { type: 'button', 'aria-pressed': String(m === mode) },
        on: {
          click: (e) => {
            mode = m;
            for (const b of tabs.querySelectorAll('button'))
              b.setAttribute('aria-pressed', String(b === e.currentTarget));
            renderControls();
            void regenerate();
          },
        },
      }),
    ),
  );

  renderControls();
  void regenerate().catch(() => (output.textContent = 'The wordlist could not be loaded.'));
  mount(
    app,
    header(
      'Generator',
      linkButton('Back', () => navigate(back)),
    ),
    h(
      'div',
      { class: 'stack pad' },
      tabs,
      h('div', { class: 'card stack' }, output, strength),
      h(
        'div',
        { class: 'row' },
        linkButton('Regenerate', () => void regenerate(), 'btn btn-secondary btn-sm'),
        linkButton(
          'Copy',
          () => void copy(output.textContent ?? '', 'Password'),
          'btn btn-secondary btn-sm',
        ),
        onUse
          ? linkButton(
              'Use',
              () => navigate(() => onUse(output.textContent ?? '')),
              'btn btn-primary btn-sm',
            )
          : null,
      ),
      controls,
    ),
  );
}

// Interaction counts as activity for auto lock, throttled so typing does not flood messages.
let lastActivity = 0;
for (const event of ['pointerdown', 'keydown'] as const) {
  document.addEventListener(
    event,
    () => {
      if (Date.now() - lastActivity < 15_000 || state?.status !== 'unlocked') return;
      lastActivity = Date.now();
      void send({ type: 'activity' }).catch(() => undefined);
    },
    { capture: true, passive: true },
  );
}

async function start(): Promise<void> {
  const settings = await send<Settings>({ type: 'settings.get' }).catch(() => null);
  if (settings) applyTheme(settings.theme);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  await refreshState();
}

void start().catch((e: unknown) =>
  mount(app, h('p', { class: 'alert alert-error pad', text: messageFor(e) })),
);
