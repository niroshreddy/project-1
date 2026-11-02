import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrateWorkspace} from '../src/workspace-storage';
import {mobileScope,mobileDimensions,MOBILE_PRESETS} from '../src/device-presets';

test('named devices with identical viewports and orientations have distinct workspace keys',()=>{
 const a={presetId:'pixel-7',orientation:'portrait' as const},b={presetId:'pixel-8',orientation:'portrait' as const};
 assert.deepEqual(mobileDimensions(a),mobileDimensions(b));assert.notEqual(mobileScope(a),mobileScope(b));
 assert.notEqual(mobileScope(a),mobileScope({...a,orientation:'landscape'}));
 assert.equal(new Set(MOBILE_PRESETS.map(p=>p.id)).size,MOBILE_PRESETS.length);
});
test('workspace v1 migration retains old mobile draft, PDF and desktop without copying into new slots',()=>{
 const pdf=new File(['test-pdf'],'reference.pdf',{type:'application/pdf'});
 const original={version:1,mode:'mobile',values:{devicePreset:{mobile:'820x1180'},targetWidth:{mobile:1180},targetHeight:{mobile:820},design:{desktop:{name:'Desktop'},mobile:{name:'Mobile'}},pdfFile:{mobile:pdf},capture:{mobile:undefined}}};
 const migrated=migrateWorkspace(original),key='mobile:820x1180:landscape';
 assert.equal(migrated.version,2);assert.deepEqual(migrated.mobile,{presetId:'820x1180',orientation:'landscape'});
 assert.equal((migrated.values.design[key] as {name:string}).name,'Mobile');assert.equal(migrated.values.pdfFile[key],pdf);
 assert.equal(migrated.values.design.desktop,original.values.design.desktop);
 assert(!Object.hasOwn(migrated.values.design,'mobile'));assert.equal(original.values.design.mobile.name,'Mobile');
 assert(Object.hasOwn(migrated.values.capture,key));assert.equal(migrated.values.design['mobile:ipad-pro-13:portrait'],undefined);
});
test('workspace load rejects unknown formats instead of discarding drafts',()=>{
 assert.throws(()=>migrateWorkspace({version:9,mode:'desktop',values:{}}));
 assert.throws(()=>migrateWorkspace({version:2,mode:'mobile',mobile:{presetId:'invalid',orientation:'portrait'},values:{}}));
 assert.equal(migrateWorkspace(undefined).version,2);
});
