import { describe,expect,it } from 'vitest'
import {
  EMPTY_ADVANCED_RULES,normalizeAdvancedRules,normalizePrivateTags,
  parseRulesCsv,validateAdvancedFields,
} from './advanced-rules'

describe('P1-17 public signed category/tag vocabulary and private metadata',()=>{
  it('canonicalizes human-entered tags with explicit size/dedup bounds',()=>{
    expect(parseRulesCsv('  report, event  ',12,48)).toEqual(['report','event'])
    expect(parseRulesCsv('',12,48)).toEqual([])
    expect(normalizePrivateTags([' report ','evidence'])).toEqual(['report','evidence'])
    expect(()=>normalizePrivateTags(['x','x'])).toThrow('assignment.duplicate_rule_label')
    expect(()=>normalizePrivateTags(['x'.repeat(49)])).toThrow('assignment.invalid_rule_label')
    expect(()=>normalizePrivateTags([''])).toThrow('assignment.invalid_rule_label')
    expect(()=>normalizePrivateTags(Array.from({length:13},(_,i)=>'tag'+i)))
      .toThrow('assignment.invalid_rule_list')
    expect(()=>parseRulesCsv('a, a',12,48)).toThrow('assignment.duplicate_rule_label')
    expect(()=>parseRulesCsv('a,,b',12,48)).toThrow('assignment.invalid_rule_label')
  })
  it('validates exact public-owner policy object and prevents type coercion',()=>{
    const rule={allowedCategories:['Report','Witness'],
      requiredTags:['evidence','field']}
    expect(normalizeAdvancedRules(rule)).toEqual(rule)
    expect(normalizeAdvancedRules(EMPTY_ADVANCED_RULES)).toEqual({
      allowedCategories:[],requiredTags:[],
    })
    for(const invalid of [
      {allowedCategories:[' Report'],requiredTags:['evidence']},
      {allowedCategories:['Report','Report'],requiredTags:[]},
      {allowedCategories:['Report'],requiredTags:'evidence'},
      {requiredTags:[],allowedCategories:[]},
      {allowedCategories:[],requiredTags:[],privateGps:'secret'},
      {allowedCategories:['secret,location'],requiredTags:[]},
      {allowedCategories:['Report'],requiredTags:['tag\u0001']},
    ])expect(()=>normalizeAdvancedRules(invalid)).toThrow()
  })
  it('does not confuse public vocabulary with actual private media metadata',()=>{
    const rules={allowedCategories:['Report','Interview'],requiredTags:['field']}
    expect(()=>validateAdvancedFields({category:'Report',tags:['field']},rules))
      .not.toThrow()
    expect(()=>validateAdvancedFields({category:'Secret',tags:['field']},rules))
      .toThrow('assignment.category_not_allowed')
    expect(()=>validateAdvancedFields({category:'Report'},rules))
      .toThrow('assignment.required_tags_missing')
    expect(()=>validateAdvancedFields({category:'Report',tags:['FIELD']},rules))
      .toThrow('assignment.required_tags_missing')
    expect(()=>validateAdvancedFields({},EMPTY_ADVANCED_RULES)).not.toThrow()
  })
})
