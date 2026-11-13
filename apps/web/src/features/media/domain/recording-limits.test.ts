import {describe, expect, it} from 'vitest'
import {assertRecordingDuration, recordingBounds, signedRecordingBudget} from './recording-limits'

describe('P2 camera audio/video recording bounds', () => {
  it('has independent 5–300 s video and 5–3000 s audio limits', () => {
    expect(recordingBounds('video')).toEqual({minMs: 5000, maxMs: 300000})
    expect(recordingBounds('audio')).toEqual({minMs: 5000, maxMs: 3000000})
  })

  it.each(['video','audio'] as const)(
    'never permits %s signed capture above ceiling after async policy preflight',kind=>{
      const signedStartedAt=1_800_000_000_000
      const {minMs,maxMs}=recordingBounds(kind)
      expect(signedRecordingBudget(kind,signedStartedAt,signedStartedAt))
        .toBe(maxMs-250)
      for(const lag of [1,230,1_900,10_000,maxMs-minMs-250]){
        const budget=signedRecordingBudget(kind,signedStartedAt,signedStartedAt+lag)
        expect(budget+lag).toBe(maxMs-250)
        expect(budget).toBeGreaterThanOrEqual(minMs)
      }
      for(const now of [signedStartedAt-1,Number.NaN,
        signedStartedAt+maxMs-minMs]){
        expect(()=>signedRecordingBudget(kind,signedStartedAt,now))
          .toThrow('camera.recording_duration_invalid')
      }
    },
  )

  it.each(['video', 'audio'] as const)('rejects premature and non-monotonic %s recording stops', kind => {
    expect(() => assertRecordingDuration(kind, 0)).toThrow('camera.recording_duration_invalid')
    expect(() => assertRecordingDuration(kind, 4999.999)).toThrow('camera.recording_duration_invalid')
    expect(() => assertRecordingDuration(kind, -1)).toThrow('camera.recording_duration_invalid')
    expect(() => assertRecordingDuration(kind, Number.NaN)).toThrow('camera.recording_duration_invalid')
    expect(() => assertRecordingDuration(kind, Number.POSITIVE_INFINITY)).toThrow('camera.recording_duration_invalid')
  })

  it.each(['video', 'audio'] as const)('accepts both exact %s boundaries', kind => {
    expect(() => assertRecordingDuration(kind, recordingBounds(kind).minMs)).not.toThrow()
    expect(() => assertRecordingDuration(kind, recordingBounds(kind).maxMs)).not.toThrow()
    expect(() => assertRecordingDuration(kind, 175000)).not.toThrow()
  })

  it.each(['video', 'audio'] as const)('rejects %s above its actual max instead of allowing the other mode cap', kind => {
    expect(() => assertRecordingDuration(kind, recordingBounds(kind).maxMs + 1))
      .toThrow('camera.recording_duration_invalid')
  })
})
