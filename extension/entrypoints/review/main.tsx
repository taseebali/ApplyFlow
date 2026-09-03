import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReviewPage } from './ReviewPage.tsx';
import '@/assets/base.css';
import '@/components/ProfileForm.css';
import './Review.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReviewPage />
  </React.StrictMode>,
);
