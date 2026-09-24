import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider, ToastProvider } from '@faculty-scheduling/ui';
import { App } from './App';

document.documentElement.classList.add('theme-admin');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SessionProvider storageKey="admin-session" allowedRoles={['ADMIN']}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  </React.StrictMode>
);
