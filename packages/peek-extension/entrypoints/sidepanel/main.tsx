import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

const container = document.getElementById('app');
if (!container) throw new Error('peek side panel: #app mount point missing');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
