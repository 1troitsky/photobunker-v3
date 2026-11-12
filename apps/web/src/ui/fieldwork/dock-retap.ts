/**
 * Approved Appearance 1.3: tapping the currently active Dock item returns
 * exactly ONE logical level inside that section. The normal (inactive)
 * RouterLink semantics are unchanged, including open-in-new-tab gestures.
 *
 * This is pure navigation data only. No encrypted Browser origin, folder,
 * search term, media object URL, identity or editor state enters the Shell.
 */
export type DockRetapAction =
  | { kind: 'none' }
  | { kind: 'back' }
  | { kind: 'replace'; path: string }

const none: DockRetapAction = {kind:'none'}

export function isDockSectionActive(currentPath:string,root:string):boolean {
  if (currentPath === root) return true
  // Current PB3 routes have nested views only for these three sections.
  // Never treat '/browsers' or '/settings-other' as descendants.
  return (root === '/assignments' || root === '/browser' || root === '/settings')
    && currentPath.startsWith(root+'/')
}

function historyPath(input:unknown):string|null {
  if (typeof input !== 'string' || !input.startsWith('/')) return null
  return input.split(/[?#]/u,1)[0] || null
}

function isFileRoute(path:string):boolean {
  return /^\/browser\/file\/(photo|media)\/[a-f0-9-]{36}$/u.test(path)
}

function editorParent(path:string):string|null {
  if (!path.endsWith('/edit')) return null
  const parent=path.slice(0,-'/edit'.length)
  return isFileRoute(parent)?parent:null
}

/**
 * A *safe* browser history back step is preferred to push/replace only if the
 * previous route is the expected logical parent. It prevents duplicate
 * Browser/Viewer pages and retains the existing Browser one-shot return
 * context; FileViewerView's onBeforeRouteLeave arms that restoration.
 *
 * Unlike window.history.back() on arbitrary state, a direct deep link always
 * falls back to router.replace(validatedParent), never leaves the app.
 */
export function resolveDockRetap(
  currentPath:string,root:string,previousUrl:unknown,
):DockRetapAction|null {
  if (!isDockSectionActive(currentPath,root)) return null
  if (currentPath===root) return none
  const previous=historyPath(previousUrl)

  if (root==='/browser') {
    const viewer=editorParent(currentPath)
    if (viewer) return previous===viewer?{kind:'back'}:{kind:'replace',path:viewer}
    if (isFileRoute(currentPath))
      return previous==='/browser'?{kind:'back'}:{kind:'replace',path:'/browser'}
    // An unknown nested path never becomes an untrusted navigation target.
    return {kind:'replace',path:'/browser'}
  }
  if (root==='/assignments') {
    // No external account or arbitrary history target is trusted.
    return previous==='/assignments'
      ? {kind:'back'} : {kind:'replace',path:'/assignments'}
  }
  if (root==='/settings') {
    // Search -> Appearance -> Search is one legitimate step backward, and
    // then Search -> Settings is another. Previous section MUST be Settings.
    // When there is no same-section history, go to Settings in one replace.
    if (previous && previous!==currentPath
      && isDockSectionActive(previous,'/settings'))
      return {kind:'back'}
    return {kind:'replace',path:'/settings'}
  }
  return none
}
