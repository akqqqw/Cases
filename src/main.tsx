import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { bootPlatform } from './platform/boot';
import { getLang, type Lang } from './platform/i18n';
import { applyMotionPreference } from './game/juice';
import './styles.css';

// The player's accessibility setting is read once before anything is drawn:
// `prefers-reduced-motion` tones down the screen shake, the confetti and the
// camera moves, and the CSS media query handles the interface animations.
applyMotionPreference();

const container = document.getElementById('root');
if (!container) throw new Error('#root container is missing in index.html');

const root = createRoot(container);
let renderedLang: Lang = getLang();

/**
 * The interface language is fixed before the first render, but the platform may
 * report a different one a moment later. A new `key` remounts the tree so every
 * screen picks the new language up.
 */
function renderApp(): void {
  renderedLang = getLang();
  root.render(<App key={renderedLang} />);
}

// The sync part of the boot (the `?lang=` switch, the local mock) runs before
// the first paint; the rest finishes in the background. A missing or broken SDK
// is a normal outcome — `bootPlatform()` never rejects.
const booted = bootPlatform();
renderApp();

void booted.then(() => {
  if (getLang() !== renderedLang) renderApp();
});
