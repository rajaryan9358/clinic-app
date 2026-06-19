import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './src/App';
import { AuthProvider } from './src/context/AuthContext';
import { ScopeProvider } from './src/context/ScopeContext';

createRoot(document.getElementById('admin-root')).render(
    <React.StrictMode>
        <BrowserRouter basename="/admin">
            <AuthProvider>
                <ScopeProvider>
                    <App />
                </ScopeProvider>
            </AuthProvider>
        </BrowserRouter>
    </React.StrictMode>
);
