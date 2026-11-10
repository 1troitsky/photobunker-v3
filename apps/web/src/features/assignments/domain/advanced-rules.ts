/**
 * Public owner-signed vocabulary (allowed categories / required tags).
 * The chosen category and actual tag values remain private AEAD metadata.
 * Signed lists are intentionally visible to accepted participants/backend.
 */
export type AdvancedRules=Readonly<{
  allowedCategories:string[]
  requiredTags:string[]
}>
export const EMPTY_ADVANCED_RULES:AdvancedRules={
  allowedCategories:[],requiredTags:[],
}
const encoder=new TextEncoder()
function normalizeLabel(value:unknown,maxBytes:number):string{
  if(typeof value!=='string')throw Error('assignment.invalid_rule_label')
  const clean=value.trim()
  if(!clean||encoder.encode(clean).length>maxBytes
    ||/[\u0000-\u001f\u007f,]/.test(clean))
    throw Error('assignment.invalid_rule_label')
  return clean
}
function labels(value:unknown,maxCount:number,maxBytes:number,
  strict:boolean):string[]{
  if(!Array.isArray(value)||value.length>maxCount)
    throw Error('assignment.invalid_rule_list')
  const normalized=value.map(item=>normalizeLabel(item,maxBytes))
  if(new Set(normalized).size!==normalized.length)
    throw Error('assignment.duplicate_rule_label')
  if(strict&&JSON.stringify(normalized)!==JSON.stringify(value))
    throw Error('assignment.noncanonical_rule_label')
  return normalized
}
/** User input: trim once; fail on duplicate, malformed, overlong labels. */
export function normalizePrivateTags(value:unknown):string[]{
  return labels(value,12,48,false)
}
export function normalizeAdvancedRules(value:unknown,strict=true):AdvancedRules{
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).join('|')!=='allowedCategories|requiredTags')
    throw Error('assignment.invalid_advanced_rules')
  const v=value as Record<string,unknown>
  return {
    allowedCategories:labels(v.allowedCategories,16,64,strict),
    requiredTags:labels(v.requiredTags,12,48,strict),
  }
}
export function validateAdvancedFields(
  actual:{category?:string;tags?:readonly string[]},rules:AdvancedRules,
):void{
  if(rules.allowedCategories.length
    &&(!actual.category||!rules.allowedCategories.includes(actual.category)))
    throw Error('assignment.category_not_allowed')
  const tags=actual.tags??[]
  if(rules.requiredTags.some(tag=>!tags.includes(tag)))
    throw Error('assignment.required_tags_missing')
}
/** Textarea comma-separated lists are clearly PUBLIC policy vocabulary. */
export function parseRulesCsv(value:string,maxCount:number,maxBytes:number):string[]{
  const values=value.trim()?value.split(',').map(v=>v.trim()):[]
  return labels(values,maxCount,maxBytes,false)
}
