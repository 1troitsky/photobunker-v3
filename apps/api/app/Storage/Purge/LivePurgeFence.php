<?php
declare(strict_types=1);

namespace App\Storage\Purge;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * #236: append-only LIVE parent purge intent. No S3 I/O, no automatic Panic.
 *
 * Call ONLY after a separately verified signed owner / Panic / TTL decision:
 * this class never authenticates requesters. Until writer + reader paths use
 * the ledger under appropriate locks, it is NOT a production deletion fence.
 * Photo and media use parent IDs, not chunk IDs: the fence covers ALL replicas.
 * Recovery Vault backups require a separate explicitly approved policy.
 */
final class LivePurgeFence
{
    private const TABLE='storage_purge_fences_v1';

    /** @return array{id:string,replayed:bool,kind:string,parentId:string} */
    public function recordAuthorized(
        string $trustedAccountId,
        string $kind,
        string $parentId,
        string $operationId,
        string $reason,
    ):array {
        $this->validate($trustedAccountId,$kind,$parentId,$operationId,$reason);
        return DB::transaction(function()use(
            $trustedAccountId,$kind,$parentId,$operationId,$reason
        ):array {
            // Intent must survive a subsequently deleted canonical parent.
            $existing=$this->find($trustedAccountId,$kind,$parentId);
            if ($existing!==null) {
                return $this->replayOrConflict($existing,$operationId,$reason,$kind,$parentId);
            }

            // Lock the canonical *parent* to serialize concurrent purge
            // authorizations and reject forged cross-account parent IDs.
            // Does NOT lock or protect other existing upload/read endpoints.
            $parentTable=$kind==='photo'?'photo_records':'media_files_v1';
            $canonical=DB::table($parentTable)
                ->where('id',$parentId)->where('account_id',$trustedAccountId)
                ->lockForUpdate()->first(['id']);
            if ($canonical===null) {
                throw new RuntimeException('storage.purge_parent_unavailable');
            }

            $id=(string)Str::uuid();
            $created=DB::table(self::TABLE)->insertOrIgnore([
                'id'=>$id,
                'account_id'=>$trustedAccountId,
                'kind'=>$kind,
                'parent_id'=>$parentId,
                'operation_id'=>$operationId,
                'reason'=>$reason,
                'created_at'=>now('UTC'),
            ]);
            $row=$this->find($trustedAccountId,$kind,$parentId);
            if ($row===null) {
                throw new RuntimeException('storage.purge_fence_unavailable');
            }
            if ((int)$created===0) {
                return $this->replayOrConflict($row,$operationId,$reason,$kind,$parentId);
            }
            return [
                'id'=>(string)$row->id,
                'replayed'=>false,
                'kind'=>$kind,
                'parentId'=>$parentId,
            ];
        },3);
    }

    /**
     * Read-only observation for trusted internal planning; a false answer
     * is NOT an atomic authorization to read, write or serve ciphertext.
     */
    public function isFenced(string $trustedAccountId,string $kind,string $parentId):bool
    {
        $this->validateIdentity($trustedAccountId,$kind,$parentId);
        return DB::table(self::TABLE)
            ->where('account_id',$trustedAccountId)
            ->where('kind',$kind)->where('parent_id',$parentId)->exists();
    }

    /** @return object|null */
    private function find(string $account,string $kind,string $parent):?object
    {
        return DB::table(self::TABLE)->where('account_id',$account)
            ->where('kind',$kind)->where('parent_id',$parent)->first();
    }

    /** @return array{id:string,replayed:bool,kind:string,parentId:string} */
    private function replayOrConflict(
        object $record,string $operation,string $reason,string $kind,string $parent
    ):array {
        if (!hash_equals((string)$record->operation_id,$operation)
            || !hash_equals((string)$record->reason,$reason)) {
            throw new RuntimeException('storage.purge_fence_conflict');
        }
        return [
            'id'=>(string)$record->id,
            'replayed'=>true,
            'kind'=>$kind,
            'parentId'=>$parent,
        ];
    }

    private function validate(
        string $account,string $kind,string $parent,string $operation,string $reason
    ):void {
        $this->validateIdentity($account,$kind,$parent);
        if (!Str::isUuid($operation)
            || !in_array($reason,['user','ttl','panic','remote_wipe'],true)) {
            throw new RuntimeException('storage.invalid_purge_intent');
        }
    }

    private function validateIdentity(string $account,string $kind,string $parent):void
    {
        if (!Str::isUuid($account)||!Str::isUuid($parent)
            || !in_array($kind,['photo','media'],true)) {
            throw new RuntimeException('storage.invalid_purge_intent');
        }
    }
}
