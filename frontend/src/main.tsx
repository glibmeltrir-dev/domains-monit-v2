import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './api.ts';
import App from './App.tsx';
import { AuthProvider } from './auth.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
