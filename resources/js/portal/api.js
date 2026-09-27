import axios from 'axios';

// Patient-portal API client. Bearer token and acting-profile header are
// attached per request from localStorage rather than kept in Axios
// defaults, so switching profiles/logging out never leaves a stale
// header behind on a client instance created earlier.
const api = axios.create({
    baseURL: '/api/portal',
    headers: {
        Accept: 'application/json',
    },
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('portal_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    const profile = localStorage.getItem('portal_profile');
    if (profile) {
        config.headers['X-Patient-Id'] = profile;
    }

    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        const path = window.location.pathname;

        if (status === 401) {
            localStorage.removeItem('portal_token');
            localStorage.removeItem('portal_profile');
            if (!path.startsWith('/portal/login')) {
                window.location.assign('/portal/login');
            }
        } else if (status === 428 && error?.response?.data?.code === 'consent_required') {
            if (path !== '/portal/consent') {
                window.location.assign('/portal/consent');
            }
        }

        return Promise.reject(error);
    },
);

export default api;
