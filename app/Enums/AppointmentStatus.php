<?php

namespace App\Enums;

enum AppointmentStatus: string
{
    case PENDING = 'pending';
    case CONFIRMED = 'confirmed';
    case CHECKED_IN = 'checked_in';
    case IN_CONSULTATION = 'in_consultation';
    case COMPLETED = 'completed';
    case CANCELLED = 'cancelled';
    case NO_SHOW = 'no_show';
    case RESCHEDULED = 'rescheduled';

    /**
     * Statuses reachable through the lifecycle (changeStatus). Completed,
     * cancelled, no-show and rescheduled are terminal; 'rescheduled' is
     * only ever set by the reschedule flow, never as a lifecycle target.
     *
     * @return array<int, self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::PENDING => [self::CONFIRMED, self::CHECKED_IN, self::CANCELLED, self::NO_SHOW],
            self::CONFIRMED => [self::CHECKED_IN, self::CANCELLED, self::NO_SHOW],
            self::CHECKED_IN => [self::IN_CONSULTATION, self::COMPLETED, self::CANCELLED, self::NO_SHOW],
            self::IN_CONSULTATION => [self::COMPLETED],
            self::COMPLETED, self::CANCELLED, self::NO_SHOW, self::RESCHEDULED => [],
        };
    }

    public function canTransitionTo(self $to): bool
    {
        return in_array($to, $this->allowedTransitions(), true);
    }

    public function label(): string
    {
        return str_replace('_', ' ', $this->value);
    }
}
