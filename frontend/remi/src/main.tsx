import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/derived.css';
import './styles/base.css';
import './styles/keyframes.css';
import './styles/view-transitions.css';
import './styles/motion.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Remi: #root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
