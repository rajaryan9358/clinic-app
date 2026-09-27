import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './session';

createRoot(document.getElementById('portal-root')).render(
    <React.StrictMode>
        <BrowserRouter basename="/portal">
            <SessionProvider>
                <App />
            </SessionProvider>
        </BrowserRouter>
    </React.StrictMode>,
);
