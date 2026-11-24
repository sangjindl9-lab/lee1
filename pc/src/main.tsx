import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initSession } from './api';
import './styles.css';

initSession().finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>));
