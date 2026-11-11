import {describe,expect,it} from 'vitest'
import viteConfig from '../../../../vite.config'

/** Runtime Vite config regression for local PB3 authenticated Matrix routes.
 * Unlike an isolated constant, this invokes the same config function used
 * by `vite dev`; no Matrix homeserver token or server is needed.
 */
describe('PB3 local Vite Matrix API routing',()=>{
  it('proxies Matrix binding and sealed 4S escrow through Laravel without rewriting Origin',()=>{
    const config=viteConfig({
      command:'serve',mode:'development',isSsrBuild:false,isPreview:false,
    })
    const proxy=config.server?.proxy
    expect(proxy?.['/matrix/v1']).toMatchObject({
      target:'http://127.0.0.1:8000',changeOrigin:false,
    })
    expect(proxy?.['/identity/v2']).toMatchObject({
      target:'http://127.0.0.1:8000',changeOrigin:false,
    })
    // The independent Matrix homeserver must NOT be the Vite API target.
    expect(JSON.stringify(proxy?.['/matrix/v1'])).not.toContain('matrix.example')
  })
})
