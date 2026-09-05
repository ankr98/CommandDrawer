import { render } from 'preact';
import { App } from './App';
import { applyTheme, watchSystemTheme } from '../shared/theme';
import { getStore } from '../shared/store';

const store = getStore();
applyTheme('system');
store.subscribe((s) => applyTheme(s.meta.settings.theme));
watchSystemTheme(() => store.getMeta().settings.theme);

render(<App />, document.getElementById('app')!);
