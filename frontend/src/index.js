import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { registerServiceWorker } from './serviceWorkerRegistration';
import { enableHScrollInteractions } from './utils/hscroll';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// PWA: офлайн-оболочка и установка на домашний экран
registerServiceWorker();

// Горизонтальные ленты должны прокручиваться мышью и колесом, а не выглядеть «мёртвыми»
enableHScrollInteractions();
