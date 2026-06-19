<?php

namespace App\Enums;

enum ClinicStatus: string
{
    case ACTIVE = 'active';
    case TRIAL = 'trial';
    case SUSPENDED = 'suspended';
    case INACTIVE = 'inactive';
}
