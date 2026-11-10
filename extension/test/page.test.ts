// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pageFill, type PageResult } from '../src/fill/page';

// Vitest runs from the extension folder. Under jsdom import.meta.url is not a file URL.
const fixtures = resolve(process.cwd(), 'test/fixtures');

/** jsdom has no layout, so fields get a box from their inline style or a default 200 by 30. */
function stubLayout(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const px = (v: string, fallback: number): number => (v === '' ? fallback : parseFloat(v));
    const left = px(this.style.left, 0);
    const top = px(this.style.top, 0);
    const width = px(this.style.width, 200);
    const height = px(this.style.height, 30);
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function load(name: string, url = 'https://login.example.com/signin'): void {
  (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom.reconfigure(
    { url },
  );
  const html = readFileSync(resolve(fixtures, name), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
}

const fill = (expectedOrigin = 'https://login.example.com'): PageResult =>
  pageFill({
    mode: 'fill',
    expectedOrigin,
    username: 'alice@example.com',
    password: 'correct horse',
  });

describe('pageFill', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = stubLayout();
  });
  afterEach(() => restore());

  it('probes without touching any field', () => {
    load('login.html');
    const r = pageFill({ mode: 'probe' });
    expect(r).toEqual({
      ok: true,
      origin: 'https://login.example.com',
      hasUsername: true,
      hasPassword: true,
      action: 'https://login.example.com/session',
      filled: [],
    });
    expect(document.querySelector<HTMLInputElement>('[name=password]')?.value).toBe('');
  });

  it('fills the username next to the password, not the first text field', () => {
    load('login.html');
    const events: string[] = [];
    document
      .querySelector('[name=password]')
      ?.addEventListener('input', () => events.push('input'));
    expect(fill()).toMatchObject({ ok: true, filled: ['username', 'password'] });
    expect(document.querySelector<HTMLInputElement>('[name=email]')?.value).toBe(
      'alice@example.com',
    );
    expect(document.querySelector<HTMLInputElement>('[name=q]')?.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('[name=password]')?.value).toBe(
      'correct horse',
    );
    expect(events).toEqual(['input']);
  });

  it('fills only the username on the first step of a multi step login', () => {
    load('multi-step.html');
    expect(fill()).toMatchObject({ ok: true, hasPassword: false, filled: ['username'] });
    expect(document.querySelector<HTMLInputElement>('#identifier')?.value).toBe(
      'alice@example.com',
    );
  });

  it('never fills hidden, transparent, zero size or off screen fields', () => {
    load('hidden-trap.html');
    expect(fill()).toEqual({ ok: false, reason: 'no-fields' });
    for (const el of document.querySelectorAll('input')) expect(el.value).toBe('');
  });

  it('refuses when the page is no longer the approved origin', () => {
    load('login.html', 'https://evil.example/login');
    expect(fill('https://login.example.com')).toEqual({ ok: false, reason: 'origin-changed' });
    expect(document.querySelector<HTMLInputElement>('[name=password]')?.value).toBe('');
  });

  it('refuses plain http outside loopback', () => {
    load('http-page.html', 'http://login.example.com/');
    expect(pageFill({ mode: 'probe' })).toEqual({ ok: false, reason: 'not-secure' });
  });

  it('reports a form posting to another site so the background can ask first', () => {
    load('cross-site-action.html');
    expect(pageFill({ mode: 'probe' })).toMatchObject({
      ok: true,
      action: 'https://collector.example.net/steal',
    });
  });

  it('ignores login forms inside frames, it only sees its own document', () => {
    load('cross-origin-iframe.html');
    expect(pageFill({ mode: 'probe' })).toEqual({ ok: false, reason: 'no-fields' });
  });

  it('is self contained, so it survives being serialised for executeScript', () => {
    const rebuilt = new Function(`return (${pageFill.toString()})`)() as typeof pageFill;
    load('login.html');
    expect(rebuilt({ mode: 'probe' })).toMatchObject({ ok: true, hasPassword: true });
  });
});
