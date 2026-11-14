/** Target P2 recording boundaries. The independent 128 MiB encrypted-media cap still applies. */
export const CAMERA_RECORDING_LIMITS = {
  video: {minMs: 5_000, maxMs: 300_000},
  audio: {minMs: 5_000, maxMs: 3_000_000},
} as const

export type RecordedMediaKind = keyof typeof CAMERA_RECORDING_LIMITS

export function recordingBounds(kind: RecordedMediaKind) {
  return CAMERA_RECORDING_LIMITS[kind]
}

/**
 * Check measured time on a monotonic clock captured at MediaRecorder start/stop,
 * not a wall clock read after asynchronous permissions/encryption work.
 */
export function assertRecordingDuration(kind: RecordedMediaKind, elapsedMs: number): void {
  const {minMs, maxMs} = recordingBounds(kind)
  if (!Number.isFinite(elapsedMs) || elapsedMs < minMs || elapsedMs > maxMs)
    throw Error('camera.recording_duration_invalid')
}

/**
 * The assignment's contributor-signed capture starts BEFORE async GPS/policy
 * preflight, while MediaRecorder's monotonic duration begins only at start().
 * Reserve a modest grace to avoid allowing a max-length recording whose
 * self-declared signed startedAt→finishedAt interval exceeds the backend cap.
 * This is a client clock declaration, NOT proof of physical recording time.
 */
export function signedRecordingBudget(
  kind: RecordedMediaKind, signedStartedAt: number, now: number,
): number {
  if(!Number.isSafeInteger(signedStartedAt)||!Number.isSafeInteger(now)
    ||now<signedStartedAt)throw Error('camera.recording_duration_invalid')
  const {minMs,maxMs}=recordingBounds(kind)
  const available=maxMs-(now-signedStartedAt)-250
  if(!Number.isSafeInteger(available)||available<minMs)
    throw Error('camera.recording_duration_invalid')
  return available
}
