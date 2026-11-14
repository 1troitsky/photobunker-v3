import { describe, expect, it } from 'vitest'
import { MAX_MEDIA_BYTES } from './media-crypto'
import {
  captureRecordingPolicy,
  CURRENT_AUDIO_RECORDING_MS,
  estimatedVideoBytesAtLimit,
  MAX_VIDEO_RECORDING_MS,
} from './capture-recording-policy'

describe('Issue #205 video capture budget', () => {
  it('allows 300 seconds of video at an advisory bitrate below encrypted-media capacity', () => {
    const { maxDurationMs, recorderOptions } = captureRecordingPolicy('video')
    expect(maxDurationMs).toBe(MAX_VIDEO_RECORDING_MS)
    expect(maxDurationMs).toBe(300_000)
    expect(recorderOptions.videoBitsPerSecond).toBe(2_400_000)
    expect(recorderOptions.audioBitsPerSecond).toBe(96_000)
    expect(estimatedVideoBytesAtLimit()).toBe(93_600_000)
    expect(estimatedVideoBytesAtLimit()).toBeLessThan(MAX_MEDIA_BYTES)
  })

  it('does not implicitly relax the independent audio #206 duration', () => {
    expect(captureRecordingPolicy('audio')).toEqual({
      maxDurationMs: CURRENT_AUDIO_RECORDING_MS,
      recorderOptions: {},
    })
    expect(CURRENT_AUDIO_RECORDING_MS).toBe(175_000)
  })

  it('does not share mutable options across recordings', () => {
    const first = captureRecordingPolicy('video')
    first.recorderOptions.videoBitsPerSecond = 1
    expect(captureRecordingPolicy('video').recorderOptions.videoBitsPerSecond)
      .toBe(2_400_000)
  })
})
