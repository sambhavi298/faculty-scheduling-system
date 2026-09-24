import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider, ToastProvider } from '@faculty-scheduling/ui';
import { App } from './App';
import './styles.css';

document.documentElement.classList.add('theme-faculty');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionProvider storageKey="faculty-session">
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  </React.StrictMode>
);
