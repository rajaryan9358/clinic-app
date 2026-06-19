import React, { createContext, useContext, useMemo, useState } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(() => {
        const raw = localStorage.getItem('auth_user');
        return raw ? JSON.parse(raw) : null;
    });

    const [loading, setLoading] = useState(false);

    const login = async ({ email, phone, password }) => {
        setLoading(true);
        try {
            const { data } = await client.post('/auth/login', { email, phone, password });
            localStorage.setItem('auth_token', data.data.token);
            localStorage.setItem('auth_user', JSON.stringify(data.data.user));
            setUser(data.data.user);
            window.dispatchEvent(new Event('auth:changed'));
            return data;
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        try {
            await client.post('/auth/logout');
        } catch {
            // ignore
        }
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        setUser(null);
        window.dispatchEvent(new Event('auth:changed'));
    };

    const value = useMemo(() => ({ user, setUser, loading, login, logout }), [user, loading]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    return useContext(AuthContext);
}
