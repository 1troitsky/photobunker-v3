import {describe, expect, it} from 'vitest'
import {
  AUDIO_TARGET_BITRATES, DEFAULT_AUDIO_TARGET_BITRATE, recordingOptions,
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
  it('never attaches microphone-only encoder quality setting to video mode', () => {
    expect(recordingOptions('video','video/webm',256000))
      .toEqual({mimeType:'video/webm'})
  })
})
