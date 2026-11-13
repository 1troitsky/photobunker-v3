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
