import type { Settings } from '../lib/schema';

/** Apply theme to <html>: explicit choice sets data-theme; 'system' follows prefers-color-scheme. */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('system-dark', !!dark);
  } else {
    root.setAttribute('data-theme', theme);
    root.classList.remove('system-dark');
  }
}

export function watchSystemTheme(get: () => Settings['theme']): void {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(get()));
}
