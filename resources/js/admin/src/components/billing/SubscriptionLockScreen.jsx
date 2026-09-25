import { useAuth } from '../../context/AuthContext';
import AppIcon from '../AppIcon';

export default function SubscriptionLockScreen({ message, clinicName }) {
    const { logout } = useAuth();

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
            <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                    <AppIcon name="alert-triangle" className="h-6 w-6 text-amber-600" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{clinicName || 'Clinic'}</p>
                <h1 className="mt-1 text-lg font-bold text-gray-900">Subscription inactive</h1>
                <p className="mt-2 text-sm text-gray-600">
                    {message && /suspend/i.test(message)
                        ? message
                        : "Your clinic's subscription is inactive. Contact your clinic admin to renew."}
                </p>
                <button
                    type="button"
                    onClick={logout}
                    className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                    <AppIcon name="log-out" className="h-3.5 w-3.5" />
                    Sign out
                </button>
            </div>
        </div>
    );
}
