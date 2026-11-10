import { browser } from 'wxt/browser';

/**
 * Chromium only. The background service worker has no DOM, so this hidden document clears the
 * clipboard on its behalf. It accepts exactly one command, and only from the background.
 */

async function clearClipboard(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText('');
    return true;
  } catch {
    // An offscreen document never has focus, which the async clipboard API may require. A copy
    // event lets us replace the clipboard contents with an empty string instead.
  }
  const onCopy = (e: ClipboardEvent): void => {
    e.clipboardData?.setData('text/plain', '');
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy);
  try {
    return document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
  }
}

browser.runtime.onMessage.addListener((raw: unknown, sender) => {
  const fromBackground =
    sender.id === browser.runtime.id &&
    !sender.tab &&
    sender.url === browser.runtime.getURL('/background.js');
  const msg = raw as { target?: unknown; type?: unknown } | null;
  if (!fromBackground || msg?.target !== 'offscreen' || msg.type !== 'clipboard.clear')
    return undefined;
  return clearClipboard().then((ok) => ({ ok }));
});
