import {prepareMediaPrivateFields} from '../../media/domain/media-crypto'
import type {MediaPrivateFields} from '../../media/domain/media-crypto'

/**
 * A separate, private MediaFile derivative. Metadata is encrypted by the
 * existing Media Outbox; this is NOT an in-place signed-manifest revision.
 * Assignment/provenance, GPS, TTL and ACL are intentionally not inherited.
 */
export type PersonalMediaCopyDraft={
  name:string
  description:string
  category:string
  tags:string[]
}
export type ValidatedPersonalMediaCopy={
  name:string
  fields:MediaPrivateFields
}
export function validatePersonalMediaCopy(
  sourceFileName:string,draft:PersonalMediaCopyDraft,
):ValidatedPersonalMediaCopy{
  if(typeof draft.name!=='string')throw Error('copy.name_required')
  const name=draft.name.trim()
  if(!name||name.length>160
    ||/[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/u.test(name)
    ||name==='.'||name==='..')
    throw Error('copy.name_invalid')
  // Never disguise executable or incompatible content under a new extension.
  // Exact MIME is retained separately by the caller and E2EE contract.
  const extension=sourceFileName.match(/\.[a-z0-9]{1,12}$/i)?.[0].toLowerCase()
  if(extension&&!name.toLowerCase().endsWith(extension))
    throw Error('copy.extension_unchanged')
  const fields=prepareMediaPrivateFields({
    description:draft.description,category:draft.category,tags:draft.tags,
  })
  return {name,fields}
}
export function isPersonalMediaCopyChanged(
  original:PersonalMediaCopyDraft,draft:PersonalMediaCopyDraft,
):boolean{
  return original.name!==draft.name||original.description!==draft.description
    ||original.category!==draft.category
    ||JSON.stringify(original.tags)!==JSON.stringify(draft.tags)
}
