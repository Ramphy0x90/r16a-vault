/**
 * A tiny DOM builder for the popup and options page.
 *
 * It only ever sets text through `textContent` and attributes through `setAttribute`, never
 * HTML, so decrypted values and server data can never become markup.
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string | boolean | undefined>>;
  readonly on?: { readonly [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  for (const [event, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(event, handler as EventListener);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Replaces everything inside `root`, then focuses the first element marked `data-autofocus`. */
export function mount(root: HTMLElement, ...children: Child[]): void {
  root.replaceChildren(...children.filter((c): c is Node | string => !!c));
  root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}

export function field(
  label: string,
  input: HTMLInputElement | HTMLSelectElement,
  hint?: string,
): HTMLElement {
  const id = input.id || `f-${Math.random().toString(36).slice(2)}`;
  input.id = id;
  const hintEl = hint
    ? h('span', { class: 'hint', text: hint, attrs: { id: `${id}-hint` } })
    : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return h(
    'div',
    { class: 'field' },
    h('label', { text: label, attrs: { for: id } }),
    input,
    hintEl,
  );
}
