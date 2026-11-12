<?php
declare(strict_types=1);

namespace App\Telemetry;

enum TelemetryDecision: string
{
    case Accepted = 'accepted';
    case Duplicate = 'duplicate';
    case Conflict = 'conflict';
    case Rejected = 'rejected';
    case OutsideWindow = 'outside_window';
}
