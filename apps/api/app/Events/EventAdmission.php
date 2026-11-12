<?php
declare(strict_types=1);

namespace App\Events;

/**
 * Receipt for internal, account-scoped event admission; NOT transport ACK or
 * a claim that downstream subscribers processed an event.
 */
enum EventAdmission: string
{
    case Accepted = 'accepted';
    case Duplicate = 'duplicate';
    case Deferred = 'deferred';
    case Conflict = 'conflict';
    case Quarantined = 'quarantined';
}
