import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider, ToastProvider } from '@faculty-scheduling/ui';
import { App } from './App';
import './styles.css';

document.documentElement.classList.add('theme-student');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <SessionProvider storageKey="student-session">
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  </React.StrictMode>
);
