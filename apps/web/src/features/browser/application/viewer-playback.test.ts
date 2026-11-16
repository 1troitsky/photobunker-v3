// @vitest-environment jsdom
import {describe,expect,it,vi} from 'vitest'
import {pauseViewerPlayback} from './viewer-playback'

describe('File Viewer 1.0 media changes',()=>{
  it('stops BOTH native players before replacing media URLs',()=>{
    const video={pause:vi.fn()}
    const audio={pause:vi.fn()}
    pauseViewerPlayback(video,audio)
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(audio.pause).toHaveBeenCalledTimes(1)
  })
  it('stops audio even if no video is mounted, and vice versa',()=>{
    const audio={pause:vi.fn()},video={pause:vi.fn()}
    pauseViewerPlayback(null,audio)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    pauseViewerPlayback(video,null)
    expect(video.pause).toHaveBeenCalledTimes(1)
  })
  it('does not fail while both media refs are gone after unmount',()=>{
    expect(()=>pauseViewerPlayback(null,undefined)).not.toThrow()
  })
})
