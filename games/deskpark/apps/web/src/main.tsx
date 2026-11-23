import '@park/engine';
import { cleanPlayerName } from '@park/protocol';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadCharacters } from './lib/characters';
import { profile } from './lib/store';
import './styles/tokens.css';
import './styles/global.css';
import './components/components.css';
import './components/mahjong.css';
import './screens/table.css';

const hostEntry = new URL(location.href);
if (hostEntry.searchParams.has('hostName')) {
  const name = cleanPlayerName(hostEntry.searchParams.get('hostName'));
  if (name) profile.set({ name });
  hostEntry.searchParams.delete('hostName');
  history.replaceState(history.state, '', hostEntry);
}

void loadCharacters();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
