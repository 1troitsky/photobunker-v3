/**
 * Browser v3 / File Viewer 1.0 media boundary.
 * The file being retired must stop playback before its decrypted object URL
 * is revoked or Vue removes its element. No cached plaintext or global state.
 */
export function pauseViewerPlayback(
  video:Pick<HTMLVideoElement,'pause'>|null|undefined,
  audio:Pick<HTMLAudioElement,'pause'>|null|undefined,
):void{
  video?.pause()
  audio?.pause()
}
