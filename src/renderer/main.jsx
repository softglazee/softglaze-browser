import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import App from './App.jsx';
import './index.css';
import { initTheme } from './lib/theme.js';
import { installDialogFocusFix } from './lib/dialogFocusFix.mjs';
import { i18nReady } from './i18n/index.js'; // English now; the saved / OS language loads before render

// Apply the saved theme before first paint to avoid a flash of the wrong theme.
initTheme();

// Native confirm()/alert() can leave the window unable to take typing on Windows;
// the main process re-focuses it after each one (see lib/dialogFocusFix.mjs).
installDialogFocusFix(window, () => window.softglaze?.ui?.refocusAfterDialog?.());

// Render once the starting language is loaded (a lazy chunk, a few ms from disk) so the first paint
// is already in the user's language; i18nReady never rejects and gives up after 4 s.
i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
});