/**
 * Recording duration must not be inferred from the recorder's bitrate.
 * Browser bitrate hints are advisory; CaptureView must independently abort
 * and discard recordings above MAX_MEDIA_BYTES before encryption/outbox.
 */
export const MAX_VIDEO_RECORDING_MS = 300_000
/** Audio duration is tracked independently by Issue #206. */
export const CURRENT_AUDIO_RECORDING_MS = 175_000
export const REQUESTED_VIDEO_BITRATE_BPS = 2_400_000
export const REQUESTED_VIDEO_AUDIO_BITRATE_BPS = 96_000

export type RecordingMode = 'video' | 'audio'

export function captureRecordingPolicy(mode: RecordingMode): {
  maxDurationMs: number
  recorderOptions: MediaRecorderOptions
} {
  if (mode === 'video') {
    return {
      maxDurationMs: MAX_VIDEO_RECORDING_MS,
      recorderOptions: {
        videoBitsPerSecond: REQUESTED_VIDEO_BITRATE_BPS,
        audioBitsPerSecond: REQUESTED_VIDEO_AUDIO_BITRATE_BPS,
      },
    }
  }
  return {
    maxDurationMs: CURRENT_AUDIO_RECORDING_MS,
    recorderOptions: {},
  }
}

/** Only an estimate; never use this in place of the hard byte limit. */
export function estimatedVideoBytesAtLimit(): number {
  return Math.ceil(
    (REQUESTED_VIDEO_BITRATE_BPS + REQUESTED_VIDEO_AUDIO_BITRATE_BPS)
      * MAX_VIDEO_RECORDING_MS / 8_000,
  )
}
