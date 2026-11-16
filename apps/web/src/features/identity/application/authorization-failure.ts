import { shallowRef } from 'vue'
/**
 * Transient, in-memory identity error UI. Never persist an auth error, recovery
 * key, filename or private state into the URL, history or storage.
 * Key parsing failures are the only presently accepted source of an error
 * screen; server-confirmed deleted/device/emergency states require their own
 * secure admission path and must NOT be inferred from ordinary network errors.
 */
export type AuthFailureReason='key'|'lost'|'deleted'|'device'|'emergency'|'local'
export const authFailure=shallowRef<AuthFailureReason|null>(null)
export const authFailureCopy:Readonly<Record<AuthFailureReason,{title:string;description:string}>>={
 key:{title:'Вход с этим ключом невозможен',description:'Ключ аккаунта недействителен, повреждён или не подходит для входа. Проверьте, что используете правильный Recovery Key.'},
 lost:{title:'Ключ аккаунта утрачен',description:'Ключ входа отсутствует на этом устройстве. Если у вас сохранилась копия Recovery Key, используйте её для восстановления доступа.'},
 deleted:{title:'Аккаунт больше недоступен',description:'Аккаунт был удалён. Войти в него с прежним ключом больше нельзя.'},
 device:{title:'Доступ с устройства закрыт',description:'Это устройство было отключено от аккаунта. Доступ с него прекращён.'},
 emergency:{title:'Доступ к аккаунту прекращён',description:'Был использован PIN экстренного удаления. Доступ с этого устройства заблокирован; возможность восстановления зависит от состояния аккаунта и резервных копий.'},
 local:{title:'Данные входа недоступны',description:'Не удалось прочитать данные авторизации на этом устройстве. Они могли быть удалены или повреждены. Попробуйте восстановить доступ с сохранённым ключом.'},
}
const invalidKeyErrors=new Set([
 'identity.invalid_key','identity.invalid_checksum','identity.recovery_mismatch',
 'identity.pending_key_mismatch','identity.invalid_base64',
])
export function markInvalidRecoveryKey(error:unknown):boolean{
 if(!(error instanceof Error)||!invalidKeyErrors.has(error.message))return false
 authFailure.value='key'
 return true
}
export function clearAuthFailure():void{authFailure.value=null}
