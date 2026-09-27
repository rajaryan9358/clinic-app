import React from 'react';
import { Card } from '../components/ui';

// Stand-in for the visits/booking/prescriptions/family pages Task 9
// builds on top of this shell, so the bottom nav has somewhere to land
// today instead of a blank route.
export default function Placeholder({ title }) {
    return (
        <Card className="py-10 text-center text-slate-500">
            <p className="text-sm">{title} is coming soon.</p>
        </Card>
    );
}
