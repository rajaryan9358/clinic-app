import React from 'react';

// Minimal hand-drawn line icons (no icon-library dependency) used across
// the portal shell and bottom nav. Each takes the same {className} prop
// as any Tailwind-sized SVG.

function Icon({ children, className = 'h-5 w-5', ...props }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...props}
        >
            {children}
        </svg>
    );
}

export function HomeIcon(props) {
    return (
        <Icon {...props}>
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V19a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
        </Icon>
    );
}

export function CalendarIcon(props) {
    return (
        <Icon {...props}>
            <rect x="3.5" y="5" width="17" height="16" rx="2" />
            <path d="M3.5 9.5h17" />
            <path d="M8 3v3.5M16 3v3.5" />
        </Icon>
    );
}

export function PlusIcon(props) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
        </Icon>
    );
}

export function PillIcon(props) {
    return (
        <Icon {...props}>
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M8 8h3v3H8zM13 13h3v3h-3z" />
        </Icon>
    );
}

export function UsersIcon(props) {
    return (
        <Icon {...props}>
            <circle cx="9" cy="8" r="3" />
            <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
            <circle cx="17" cy="9.5" r="2.2" />
            <path d="M15.5 14a4.2 4.2 0 0 1 4.9 5.5" />
        </Icon>
    );
}

export function LogoutIcon(props) {
    return (
        <Icon {...props}>
            <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
            <path d="M16 16l4-4-4-4" />
            <path d="M20 12H9" />
        </Icon>
    );
}

export function SwitchIcon(props) {
    return (
        <Icon {...props}>
            <path d="M7 7h11l-3-3" />
            <path d="M17 17H6l3 3" />
        </Icon>
    );
}

export function ChevronRightIcon(props) {
    return (
        <Icon {...props}>
            <path d="M9 6l6 6-6 6" />
        </Icon>
    );
}

export function ChevronLeftIcon(props) {
    return (
        <Icon {...props}>
            <path d="M15 6l-6 6 6 6" />
        </Icon>
    );
}

export function MapPinIcon(props) {
    return (
        <Icon {...props}>
            <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
            <circle cx="12" cy="10" r="2.3" />
        </Icon>
    );
}

export function PhoneIcon(props) {
    return (
        <Icon {...props}>
            <path d="M5 4h3l1.5 4-2 1.3a11 11 0 0 0 7.2 7.2L16 14.5l4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />
        </Icon>
    );
}

export function DownloadIcon(props) {
    return (
        <Icon {...props}>
            <path d="M12 4v11" />
            <path d="M7.5 10.5 12 15l4.5-4.5" />
            <path d="M5 19.5h14" />
        </Icon>
    );
}

export function ClockIcon(props) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
        </Icon>
    );
}
