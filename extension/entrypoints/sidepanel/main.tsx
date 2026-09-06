import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '@/assets/base.css';
import '@/components/forms.css';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
