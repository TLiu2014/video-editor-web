import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import {
  applyThemeToDocument,
  readPersistedTheme,
} from './store/useThemeStore';

// Apply the persisted theme synchronously so the initial paint is
// already in the right colors — avoids a one-frame light/dark flash
// on reload when the user picked the non-default theme.
applyThemeToDocument(readPersistedTheme());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
