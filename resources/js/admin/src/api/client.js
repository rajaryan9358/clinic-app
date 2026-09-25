import axios from 'axios';

const client = axios.create({
    baseURL: '/api',
    headers: {
        Accept: 'application/json',
    },
});

client.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    const activeDoctorId = localStorage.getItem('active_doctor_id');
    if (activeDoctorId) {
        config.headers['X-Doctor-Id'] = activeDoctorId;
    }
    return config;
});

export default client;
