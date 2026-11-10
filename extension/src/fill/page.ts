/**
 * The only code Zaltys ever runs inside a web page.
 *
 * It is injected with `scripting.executeScript({ func: pageFill, args })` into the top frame
 * after the user asked for a fill, and it is serialised as source text, so it must not refer
 * to anything outside its own body. Probe and fill share this one function, so both always
 * pick the same fields.
 *
 * A probe receives no secrets and reports only the page origin and which kinds of fields
 * exist. A fill receives one username and password and first checks that the page is still
 * the origin the background approved, because the page may have navigated after the probe.
 */

export interface ProbeArgs {
  readonly mode: 'probe';
}

export interface FillArgs {
  readonly mode: 'fill';
  readonly expectedOrigin: string;
  readonly username: string;
  readonly password: string;
}

export type PageResult =
  | {
      readonly ok: true;
      readonly origin: string;
      readonly hasUsername: boolean;
      readonly hasPassword: boolean;
      /** Absolute URL the login form posts to, or null when it posts to the page itself. */
      readonly action: string | null;
      readonly filled: readonly ('username' | 'password')[];
    }
  | { readonly ok: false; readonly reason: 'not-secure' | 'no-fields' | 'origin-changed' };

export function pageFill(args: ProbeArgs | FillArgs): PageResult {
  if (
    location.protocol !== 'https:' &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1'
  ) {
    return { ok: false, reason: 'not-secure' };
  }
  if (args.mode === 'fill' && location.origin !== args.expectedOrigin) {
    return { ok: false, reason: 'origin-changed' };
  }

  // Fields that a person can actually see and type into. Traps hide fields with tiny size,
  // transparency, off screen positions, clipping or hidden ancestors to collect autofilled
  // secrets. A zero width input still has padding and border, so the threshold sits well
  // above that, and well below any real input.
  const MIN_SIZE = 8;
  const usable = (el: HTMLInputElement): boolean => {
    if (!el.isConnected || el.disabled || el.readOnly || el.type === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return false;
    if (rect.right + scrollX <= 0 || rect.bottom + scrollY <= 0) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      )
        return false;
      if (parseFloat(style.opacity) === 0) return false;
      if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) return false;
      if (
        node !== el &&
        /hidden|clip/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)
      ) {
        const box = node.getBoundingClientRect();
        if (box.width < MIN_SIZE || box.height < MIN_SIZE) return false;
      }
    }
    return true;
  };
  const inputs = (root: ParentNode): HTMLInputElement[] =>
    Array.from(root.querySelectorAll('input')).filter(usable);
  const textLike = (el: HTMLInputElement): boolean =>
    ['text', 'email', 'tel', ''].includes(el.type) &&
    (/username|email/.test(el.autocomplete) ||
      el.type === 'email' ||
      /user|login|email|account|identifier/i.test(`${el.name} ${el.id}`));

  const password = inputs(document).find((el) => el.type === 'password') ?? null;
  const scope: ParentNode = password?.form ?? document;
  let username: HTMLInputElement | null = null;
  const candidates = inputs(scope).filter((el) => el !== password && el.type !== 'password');
  if (password) {
    // The username sits before the password in the same form. Prefer explicit hints, then
    // the nearest plain text field.
    const before = candidates.filter(
      (el) => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    username =
      before.filter(textLike).pop() ??
      before.filter((el) => ['text', 'email', ''].includes(el.type)).pop() ??
      null;
  } else {
    // First step of a multi step login shows only the username.
    username = candidates.find(textLike) ?? null;
  }
  if (!password && !username) return { ok: false, reason: 'no-fields' };

  const form = (password ?? username)?.form ?? null;
  const action = form && form.hasAttribute('action') ? form.action : null;

  const filled: ('username' | 'password')[] = [];
  if (args.mode === 'fill') {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const put = (el: HTMLInputElement, value: string): void => {
      // Frameworks track the native setter, so assigning through it and firing input and
      // change events is what makes the page notice the new value.
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (username && args.username) {
      put(username, args.username);
      filled.push('username');
    }
    if (password) {
      put(password, args.password);
      filled.push('password');
    }
  }
  return {
    ok: true,
    origin: location.origin,
    hasUsername: !!username,
    hasPassword: !!password,
    action,
    filled,
  };
}
