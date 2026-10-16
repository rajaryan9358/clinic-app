const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loading = null;

// Loads Razorpay Checkout on demand (first tap on Pay), once. A failed load
// is not cached, so the patient can retry.
export function loadRazorpay() {
    if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(window.Razorpay);
    if (loading) return loading;

    loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CHECKOUT_SRC;
        script.async = true;
        script.onload = () => {
            loading = null;
            if (window.Razorpay) resolve(window.Razorpay);
            else reject(new Error('Razorpay unavailable'));
        };
        script.onerror = () => {
            loading = null;
            script.remove();
            reject(new Error('Razorpay failed to load'));
        };
        document.head.appendChild(script);
    });

    return loading;
}
