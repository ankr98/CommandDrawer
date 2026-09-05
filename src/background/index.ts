/**
 * Service worker. Deliberately tiny: no `tabs` permission is needed for
 * tabs.onRemoved (it only delivers the tab id), and the popup does the rest.
 */
import { chromeSession, clearTab } from '../lib/session';

// Registered at top level so the worker wakes up for it. Plan §5.3 cleanup.
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTab(chromeSession(), tabId).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First run: nothing to seed. Empty state in the popup explains the next step.
    console.info('[command-drawer] installed');
  }
});
