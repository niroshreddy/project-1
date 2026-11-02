import {test} from 'node:test';
import assert from 'node:assert/strict';
import {carryReview,issueKey,issueText} from '../src/review';
import type {Comparison,Issue} from '../src/types';
const issue:Issue={id:'a',title:'Button shifted',category:'layout',severity:'medium',confidence:.8,expected:'Aligned',actual:'Shifted',explanation:'Raster position changed',recommendation:'Inspect alignment',annotation:'rectangle',box:{x:.1,y:.1,width:.2,height:.2}};
const record:Comparison={id:'baseline',createdAt:'',design:{image:'same',name:'ref',width:1000,height:600},capture:{image:'actual',capturedAt:'now',snapshot:{url:'https://example.com/',title:'Example',width:1000,height:600,dpr:1,scrollX:0,scrollY:0,elements:[]}},issues:[issue],model:'test',summary:'',diff:{changedPercent:1,regions:[]}};
test('accepted differences persist only when evidence and capture context match',()=>{
 const baseline={...record,issues:[{...issue,review:{status:'accepted' as const,owner:'Sam',impact:'intentional',comment:'approved',updatedAt:'now'}}]};
 const next=carryReview({...record,id:'next'},baseline);assert.equal(next.issues[0].dismissed,true);assert.equal(next.issues[0].review?.owner,'Sam');
 const changed=carryReview({...record,id:'next',issues:[{...issue,actual:'Now missing'}]},baseline);assert.equal(changed.issues[0].dismissed,undefined);
 assert.throws(()=>carryReview({...record,capture:{...record.capture,snapshot:{...record.capture.snapshot,width:375}}},baseline),/same URL/);
});
test('verification distinguishes still detected from not detected without declaring fixes',()=>{
 const result=carryReview({...record,id:'next',issues:[]},record);assert.equal(result.verification?.[0].outcome,'not-detected');
 assert.equal(carryReview({...record,id:'next'},record).verification?.[0].outcome,'still-detected');
});
test('a previously marked fixed issue is reopened when the same evidence recurs',()=>{
 const fixed={...record,issues:[{...issue,dismissed:true,review:{status:'fixed' as const,owner:'Sam',impact:'',comment:'',updatedAt:'now'}}]};
 assert.equal(carryReview({...record,id:'next'},fixed).issues[0].review?.status,'open');
});
test('tracker text includes reproducible context and labels bounds as raster evidence',()=>{
 assert.match(issueText(record,issue),/x=100, y=60, width=200, height=120/);assert.match(issueText(record,issue),/not CSS measurements/);assert.notEqual(issueKey(issue),issueKey({...issue,expected:'new'}));
});
