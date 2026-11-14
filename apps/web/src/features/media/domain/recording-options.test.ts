import {describe, expect, it} from 'vitest'
import {MAX_MEDIA_BYTES} from './media-crypto'
import {
  AUDIO_TARGET_BITRATES, DEFAULT_AUDIO_TARGET_BITRATE, recordingOptions,
  VIDEO_TARGET_BITRATE_BPS, VIDEO_AUDIO_TARGET_BITRATE_BPS,
} from './recording-options'

describe('native audio encoder target config', () => {
  it('lists the four P2 quality targets with a safe default', () => {
    expect(AUDIO_TARGET_BITRATES).toEqual([64000,128000,192000,256000])
    expect(DEFAULT_AUDIO_TARGET_BITRATE).toBe(128000)
  })
  it.each(AUDIO_TARGET_BITRATES)('requests actual MediaRecorder audio target of %i bps', rate => {
    expect(recordingOptions('audio','audio/webm',rate))
      .toEqual({mimeType:'audio/webm',audioBitsPerSecond:rate})
  })
  it.each([0,63999,128001,257000,-1,NaN,Infinity])(
    'rejects invalid audio encoder target %s without silent fallback', rate => {
      expect(()=>recordingOptions('audio','audio/webm',rate))
        .toThrow('camera.audio_target_bitrate_invalid')
    },
  )
  it('uses conservative #205 video codec hints without inheriting audio-only selector', () => {
    expect(recordingOptions('video','video/webm',256000)).toEqual({
      mimeType:'video/webm',
      videoBitsPerSecond:2_400_000,
      audioBitsPerSecond:96_000,
    })
    expect(recordingOptions('audio','audio/webm',256000)).toEqual({
      mimeType:'audio/webm',
      audioBitsPerSecond:256000,
    })
  })
  it('keeps a 300s video bitrate target under the independent 128MiB hard cap', () => {
    const target=Math.ceil(
      (VIDEO_TARGET_BITRATE_BPS+VIDEO_AUDIO_TARGET_BITRATE_BPS)*300_000/8_000,
    )
    expect(target).toBe(93_600_000)
    expect(target).toBeLessThan(MAX_MEDIA_BYTES)
    const first=recordingOptions('video','video/webm',128000)
    first.videoBitsPerSecond=1
    expect(recordingOptions('video','video/webm',128000).videoBitsPerSecond)
      .toBe(VIDEO_TARGET_BITRATE_BPS)
  })
})
