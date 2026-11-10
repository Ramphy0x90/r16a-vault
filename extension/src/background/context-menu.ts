import { browser } from 'wxt/browser';

import { fill } from './fill';
import { list } from './vault';

/**
 * "Fill with Zaltys" on editable fields. The click is the user gesture that grants activeTab.
 *
 * A menu cannot ask which credential to use, so it fills only when the choice is unambiguous,
 * a single exact host match, or else a single match on the registrable domain. Anything else
 * opens the popup, which lists the matches.
 */

const MENU_ID = 'zaltys-fill';

export function createMenu(): void {
  browser.contextMenus.create({ id: MENU_ID, title: 'Fill with Zaltys', contexts: ['editable'] });
}

export function listenForMenu(): void {
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined || info.frameId !== 0) return;
    void fillBest(tab.id);
  });
}

async function fillBest(tabId: number): Promise<void> {
  try {
    const { items } = await list(tabId);
    const exact = items.filter((c) => c.level === 'exact');
    const domain = items.filter((c) => c.level === 'domain');
    const only =
      exact.length === 1 ? exact[0] : exact.length === 0 && domain.length === 1 ? domain[0] : null;
    if (only) {
      const outcome = await fill(tabId, only.id, false);
      if (outcome.status === 'filled') return;
    }
  } catch {
    // Locked, offline or no access. The popup explains which.
  }
  await (browser.action as { openPopup?: () => Promise<void> })
    .openPopup?.()
    .catch(() => undefined);
}
