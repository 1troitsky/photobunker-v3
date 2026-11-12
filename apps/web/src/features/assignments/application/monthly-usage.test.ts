import {describe,expect,it} from 'vitest'
import {
  ASSIGNMENT_PLAN_IDS,assignmentMonthlyPlanLabel,parseAssignmentMonthlyUsage,
} from './monthly-usage'

const base={
  planId:'free',catalogVersion:'pb3-2026-11-12',
  periodStart:'2026-11-01T00:00:00+00:00',
  periodEnd:'2026-12-01T00:00:00+00:00',
  limit:3,used:1,remaining:2,
}

describe('P1 #277: authoritative five-plan UTC Assignment allowance',()=>{
  it('accepts all five paid/free plan IDs and displays the actual server plan',()=>{
    expect(ASSIGNMENT_PLAN_IDS).toEqual([
      'free','go','pro','unlimited','unlimited_plus',
    ])
    const cases=[
      {planId:'free',limit:3,used:1,remaining:2,label:'Free'},
      {planId:'go',limit:30,used:4,remaining:26,label:'Go'},
      {planId:'pro',limit:100,used:30,remaining:70,label:'Pro'},
      {planId:'unlimited',limit:null,used:123,remaining:null,label:'Unlimited'},
      {planId:'unlimited_plus',limit:null,used:4000,remaining:null,label:'Unlimited+'},
    ] as const
    for(const {planId,limit,used,remaining,label} of cases){
      const usage=parseAssignmentMonthlyUsage({
        ...base,planId,limit,used,remaining,
      })
      expect(usage).toMatchObject({planId,limit,used,remaining})
      expect(assignmentMonthlyPlanLabel(usage.planId)).toBe(label)
    }
  })

  it('supports a paid-to-Free downgrade without refunding previously created assignments',()=>{
    expect(parseAssignmentMonthlyUsage({
      ...base,limit:3,used:5,remaining:0,
    })).toMatchObject({planId:'free',limit:3,used:5,remaining:0})
    expect(parseAssignmentMonthlyUsage({
      ...base,planId:'go',limit:30,used:30,remaining:0,
    }).remaining).toBe(0)
  })

  it('accepts an exact leap-month UTC rollover rather than a rolling 30-day range',()=>{
    const usage=parseAssignmentMonthlyUsage({
      ...base,periodStart:'2028-02-01T00:00:00Z',
      periodEnd:'2028-03-01T00:00:00Z',
    })
    expect(usage.periodEnd).toBe('2028-03-01T00:00:00Z')
  })

  it('fails closed on forged plan, null mismatch, and under/over-counted usage',()=>{
    const invalid=[
      null,[],1,'free',{},
      {...base,planId:'enterprise'},
      {...base,planId:null},
      {...base,planId:'Go'},
      {...base,limit:null,remaining:0},
      {...base,limit:null,remaining:null}, // Free cannot claim Unlimited.
      {...base,planId:'go',limit:null,remaining:null},
      {...base,planId:'unlimited',limit:5,remaining:4},
      {...base,limit:30,remaining:null},
      {...base,limit:undefined},
      {...base,limit:-1},
      {...base,limit:1.5},
      {...base,limit:Number.MAX_SAFE_INTEGER+1},
      {...base,used:-1},
      {...base,used:1.25},
      {...base,used:'1'},
      {...base,used:Number.MAX_SAFE_INTEGER+1},
      {...base,remaining:3},
      {...base,remaining:1},
      {...base,remaining:1.5},
      {...base,remaining:-1},
      {...base,catalogVersion:'  '},
      {...base,catalogVersion:''},
    ]
    for(const value of invalid){
      expect(()=>parseAssignmentMonthlyUsage(value))
        .toThrow('assignment.usage_invalid')
    }
  })

  it('rejects malformed periods, non-UTC boundaries, and non-month windows',()=>{
    const invalid=[
      {...base,periodStart:null},
      {...base,periodStart:'not-a-date'},
      {...base,periodEnd:'not-a-date'},
      {...base,periodStart:'2026-11-02T00:00:00Z'},
      {...base,periodStart:'2026-11-01T00:00:00+04:00'},
      {...base,periodStart:'2026-11-01T01:00:00Z'},
      {...base,periodEnd:'2026-11-30T00:00:00Z'},
      {...base,periodEnd:'2026-11-01T00:00:00Z'},
      {...base,periodEnd:'2027-01-01T00:00:00Z'},
      {...base,periodEnd:15},
    ]
    for(const value of invalid){
      expect(()=>parseAssignmentMonthlyUsage(value))
        .toThrow('assignment.usage_invalid')
    }
  })
})
