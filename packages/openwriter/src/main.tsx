import React from 'react';
import ReactDOM from 'react-dom/client';

import { initAppearance } from './themes/appearance-store';
import { RightRailProvider } from './right-rail/RightRailContext';
import './themes/vendored-fonts.css';
import './themes/colors-base.css';
import './themes/colors-extra.css';
import './themes/typefaces.css';
import './sidebar/sidebar-styles.css';
import './sidebar/sidebar-compact.css';
import './themes/canvas-styles.css';
import './themes/spacing-presets.css';
import './tweet-compose/tweet-compose.css';
import './article-compose/ArticleComposeView.css';
import App from './App';
import './App.css';

initAppearance();

// RightRailProvider is hoisted above <App> (not nested inside App's return) so
// App itself can read rail open/width + push the responsive overlay flag down
// into the rail. Every rail consumer still sits under this single provider.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RightRailProvider>
      <App />
    </RightRailProvider>
  </React.StrictMode>
);
