import React from 'react';
import ReactDOM from 'react-dom/client';

import { initAppearance } from './themes/appearance-store';
import './themes/themes-base.css';
import './themes/themes-extra.css';
import './themes/typography-presets.css';
import './sidebar/sidebar-styles.css';
import './themes/canvas-styles.css';
import App from './App';
import './App.css';

initAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
