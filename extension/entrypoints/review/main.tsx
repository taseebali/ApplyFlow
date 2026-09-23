import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReviewPage } from './ReviewPage.tsx';
import '@/assets/base.css';
import '@/components/forms.css';
import './Review.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ReviewPage />
    </ErrorBoundary>
  </React.StrictMode>,
);
