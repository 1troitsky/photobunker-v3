/** MediaRecorder bitrate is an encoder *target*, never an authenticated quality proof. */
export const AUDIO_TARGET_BITRATES = [64_000, 128_000, 192_000, 256_000] as const
export type AudioTargetBitrate = typeof AUDIO_TARGET_BITRATES[number]
export const DEFAULT_AUDIO_TARGET_BITRATE: AudioTargetBitrate = 128_000

/**
 * Reject malformed requests rather than silently choosing a lower quality.
 * The UA remains free to encode at a different actual bitrate/codec.
 */
export function recordingOptions(
  kind: 'video'|'audio', mimeType: string, audioTargetBitrate: number,
): MediaRecorderOptions {
  if (kind === 'audio') {
    if (!(AUDIO_TARGET_BITRATES as readonly number[]).includes(audioTargetBitrate))
      throw Error('camera.audio_target_bitrate_invalid')
    return {mimeType, audioBitsPerSecond: audioTargetBitrate}
  }
  return {mimeType}
}
