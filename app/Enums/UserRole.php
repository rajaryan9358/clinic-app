<?php

namespace App\Enums;

enum UserRole: string
{
    case SUPER_ADMIN = 'super_admin';
    case CLINIC_ADMIN = 'clinic_admin';
    case DOCTOR = 'doctor';
    case RECEPTIONIST = 'receptionist';
    case ASSISTANT = 'assistant';
}
