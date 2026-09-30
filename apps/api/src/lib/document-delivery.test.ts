import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateExternalDeliveryRequest,externalDeliveryState} from './document-delivery.js';

test('Peppol unavailable rejects even an externally confirmed request',()=>{
 for(const body of [{peppol:true},{peppol:true,confirmedExternal:true}]) assert.throws(()=>validateExternalDeliveryRequest(body),{status:503});
});
test('external sending requires an explicit boolean confirmation',()=>{
 for(const body of [null,{}, {confirmedExternal:false},{confirmedExternal:'true'}]) assert.throws(()=>validateExternalDeliveryRequest(body),{status:422});
 assert.doesNotThrow(()=>validateExternalDeliveryRequest({confirmedExternal:true}));
});
test('external delivery never issues drafts or reopens financial states',()=>{
 assert.throws(()=>externalDeliveryState({lockedAt:null,status:'draft',sentAt:null}),{status:409});
 for(const status of ['paid','partial','credited','accepted','declined','overdue'])assert.equal(externalDeliveryState({lockedAt:new Date(),status,sentAt:null}).status,status);
 assert.equal(externalDeliveryState({lockedAt:new Date(),status:'sent',sentAt:new Date()}).alreadyRecorded,true);
 assert.throws(()=>externalDeliveryState({lockedAt:new Date(),status:'cancelled',sentAt:null}),{status:409});
});
