
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './App';

import './index.css';

const isSecureContext = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
if ('serviceWorker' in navigator && isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(registration => {
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function updateDarkClass(e = null) {
  const isDark = e ? e.matches : darkQuery.matches;
  document.documentElement.classList.toggle('dark', isDark);
}

updateDarkClass();
darkQuery.addEventListener('change', updateDarkClass);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
