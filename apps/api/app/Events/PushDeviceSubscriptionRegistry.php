<?php
declare(strict_types=1);

namespace App\Events;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Internal staging registry ONLY. Nothing here sends push or exposes a public
 * registration endpoint. A future signed-worker trust gate and a separately
 * authenticated controller must precede any browser use.
 *
 * Endpoint/auth/key are encrypted together with Laravel's authenticated
 * encryption key, never put in event metadata, logs, notifications or SQL
 * search indexes. No outbound requests or DNS resolution occur here.
 */
final class PushDeviceSubscriptionRegistry
{
    private const TABLE = 'notification_push_subscriptions_v1';

    /** Provider endpoints are deliberately limited before a sender exists. */
    private const PROVIDER_HOSTS = [
        'fcm.googleapis.com',
        'updates.push.services.mozilla.com',
        'push.services.mozilla.com',
        'web.push.apple.com',
    ];

    /**
     * @param array{endpoint:string,p256dh:string,auth:string} $subscription
     * @return array{registered:bool,generation:int}
     */
    public function put(string $accountId, string $deviceId, array $subscription): array
    {
        $this->validate($subscription);
        $endpoint = $subscription['endpoint'];
        $index = hash('sha256', $endpoint);

        return DB::transaction(static function () use (
            $accountId, $deviceId, $subscription, $index
        ): array {
            self::authorizeDevice($accountId, $deviceId);
            $other = DB::table(self::TABLE)->where('endpoint_hash', $index)
                ->where('device_id', '<>', $deviceId)->exists();
            if ($other) {
                throw new InvalidArgumentException('notifications.push.endpoint_claimed');
            }

            $row = DB::table(self::TABLE)
                ->where('device_id', $deviceId)->lockForUpdate()->first();
            $ciphertext = Crypt::encryptString(json_encode(
                $subscription, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
            ));
            if ($row === null) {
                DB::table(self::TABLE)->insert([
                    'account_id' => $accountId,
                    'device_id' => $deviceId,
                    'endpoint_hash' => $index,
                    'subscription_ciphertext' => $ciphertext,
                    'generation' => 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                    'disabled_at' => null,
                ]);
                return ['registered' => true, 'generation' => 1];
            }
            if ($row->account_id !== $accountId) {
                throw new InvalidArgumentException('notifications.push.invalid_device');
            }
            // Never need to decrypt the old secret to renew: replacing the
            // full authenticated ciphertext rotates secrets atomically.
            $generation = (int) $row->generation + 1;
            DB::table(self::TABLE)->where('device_id', $deviceId)->update([
                'endpoint_hash' => $index,
                'subscription_ciphertext' => $ciphertext,
                'generation' => $generation,
                'disabled_at' => null,
                'updated_at' => now(),
            ]);
            return ['registered' => true, 'generation' => $generation];
        }, 3);
    }

    public function disable(string $accountId, string $deviceId): bool
    {
        return DB::transaction(static function () use ($accountId, $deviceId): bool {
            self::authorizeDevice($accountId, $deviceId);
            return DB::table(self::TABLE)
                ->where('account_id', $accountId)
                ->where('device_id', $deviceId)
                ->whereNull('disabled_at')
                ->update(['disabled_at' => now(), 'updated_at' => now()]) === 1;
        }, 3);
    }

    /**
     * A fail-closed eligibility predicate, NOT a promise of actual delivery.
     * A revoked device cannot be re-enabled even if a stale row remains.
     */
    public function eligible(string $accountId, string $deviceId): bool
    {
        return DB::table(self::TABLE.' as p')
            ->join('identity_accounts as a','a.id','=','p.account_id')
            ->join('identity_devices as d','d.id','=','p.device_id')
            ->where('p.account_id', $accountId)
            ->where('p.device_id', $deviceId)
            ->whereNull('p.disabled_at')
            ->where('a.status', 'ready')
            ->where('d.account_id', $accountId)
            ->whereNull('d.revoked_at')
            ->exists();
    }

    /** Account first, device second, as in identity and event ledger. */
    private static function authorizeDevice(string $accountId, string $deviceId): void
    {
        if (!EventEnvelope::isCanonicalUuid($accountId)
            || !EventEnvelope::isCanonicalUuid($deviceId)) {
            throw new InvalidArgumentException('notifications.push.invalid_device');
        }
        $account = DB::table('identity_accounts')->where('id', $accountId)
            ->lockForUpdate()->first(['status']);
        $device = DB::table('identity_devices')
            ->where('id', $deviceId)->where('account_id', $accountId)
            ->lockForUpdate()->first(['revoked_at']);
        if ($account === null || $account->status !== 'ready'
            || $device === null || $device->revoked_at !== null) {
            throw new InvalidArgumentException('notifications.push.invalid_device');
        }
    }

    /** @param array<string,mixed> $data */
    private function validate(array $data): void
    {
        $keys = array_keys($data);
        sort($keys);
        if ($keys !== ['auth','endpoint','p256dh']) {
            throw new InvalidArgumentException('notifications.push.invalid_subscription');
        }
        $endpoint = $data['endpoint'];
        if (!is_string($endpoint) || strlen($endpoint) > 2048
            || strlen($endpoint) < 32 || preg_match('/[\x00-\x20\x7f]/', $endpoint)) {
            throw new InvalidArgumentException('notifications.push.invalid_subscription');
        }
        $url = parse_url($endpoint);
        if ($url === false || ($url['scheme'] ?? '') !== 'https'
            || !in_array(strtolower((string)($url['host'] ?? '')), self::PROVIDER_HOSTS, true)
            || isset($url['user']) || isset($url['pass'])
            || isset($url['fragment'])
            || (isset($url['port']) && $url['port'] !== 443)
            || empty($url['path'])) {
            throw new InvalidArgumentException('notifications.push.invalid_subscription');
        }
        foreach (['p256dh' => 65, 'auth' => 16] as $field => $bytes) {
            $encoded = $data[$field];
            if (!is_string($encoded)
                || preg_match('/\A[A-Za-z0-9_-]+\z/D', $encoded) !== 1) {
                throw new InvalidArgumentException('notifications.push.invalid_subscription');
            }
            $decoded = base64_decode(strtr($encoded, '-_', '+/'), true);
            if ($decoded === false || strlen($decoded) !== $bytes
                || rtrim(strtr(base64_encode($decoded), '+/', '-_'), '=') !== $encoded
                || ($field === 'p256dh' && $decoded[0] !== "\x04")) {
                throw new InvalidArgumentException('notifications.push.invalid_subscription');
            }
        }
    }
}
