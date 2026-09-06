import assert from 'node:assert/strict';
const base='http://127.0.0.1:8787';let checks=0;const tag=Date.now().toString(36),A='qa_owner_'+tag,B='qa_engineer_'+tag,C='qa_artist_'+tag,D='qa_other_'+tag;
const headers=id=>id?{'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.test'}:{};
async function call(id,path,body,status=200,extra={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers(id),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});const t=await r.text();assert.equal(r.status,status,path+': '+t);checks++;try{return JSON.parse(t);}catch{return t;}}
const act=(id,b,status=200)=>call(id,'/api/action',b,status);
await act(null,{action:'profile'},401);
await call(A,'/api/action',{action:'saved',id:'demo-1',value:true},503,{Origin:'https://unrelated.example'});
for(const [id,role]of[[A,'Producer'],[B,'Engineer'],[C,'Artist']])await act(id,{action:'profile',username:id.slice(0,24),name:'QA '+role,roles:[role],visibility:'private'});
const raw=new Uint8Array(204),v=new DataView(raw.buffer);function s(i,t){for(let x=0;x<t.length;x++)raw[i+x]=t.charCodeAt(x);}s(0,'RIFF');v.setUint32(4,196,true);s(8,'WAVE');s(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);s(36,'data');v.setUint32(40,160,true);
const fd=new FormData();fd.set('purpose','audio');fd.set('file',new File([raw],'test.wav',{type:'audio/wav'}));const up=await fetch(base+'/api/upload',{method:'POST',headers:headers(A),body:fd});assert.equal(up.status,200,await up.clone().text());checks++;const file=await up.json();
const track=await act(A,{action:'track',fileId:file.id,title:'QA private beat',kind:'beat',genre:'Hip-hop',bpm:92,musicalKey:'C minor',visibility:'private',permission:'listen',rights:true});
const state=await call(B,'/api/state');assert(!state.tracks.some(t=>t.id===track.id));assert(!state.profiles.some(p=>p.id===A));checks+=2;
await call(B,'/api/file/'+file.id,undefined,404);await call(null,'/api/file/'+file.id,undefined,404);await call(A,'/api/file/'+file.id);
await act(A,{action:'visibility',id:track.id,visibility:'public',permission:'listen'});await call(B,'/api/file/'+file.id);
const data={bpm:92,tracks:[{id:'ch1',fileId:file.id,name:'QA',volume:.8,pan:0,offset:0,trimStart:0,trimEnd:0,muted:false,solo:false,low:0,mid:0,high:0}]};
await act(B,{action:'project',title:'QA no reuse',data},403);
await act(A,{action:'visibility',id:track.id,visibility:'public',permission:'collaborate'});const project=await act(B,{action:'project',title:'QA engineer',data});await act(A,{action:'visibility',id:track.id,visibility:'private',permission:'listen'});await call(B,'/api/file/'+file.id);await call(C,'/api/file/'+file.id,undefined,404);
const room=await act(B,{action:'room',title:'QA session',project:project.id});await call(C,'/api/room/'+room.id,undefined,403);const roomData=await call(B,'/api/room/'+room.id);assert(roomData.room.invite);checks++;
await act(C,{action:'joinRoom',id:room.id,invite:'bad'},403);await act(C,{action:'joinRoom',id:room.id,invite:roomData.room.invite});const member=await call(C,'/api/room/'+room.id);assert(!member.room.invite);checks++;
await call(C,'/api/file/'+file.id);await act(C,{action:'projectRead',id:project.id});await act(C,{action:'project',id:project.id,title:'QA overwrite',data},403);await call(D,'/api/file/'+file.id,undefined,404);await act(D,{action:'projectRead',id:project.id},403);await act(C,{action:'removeMember',id:room.id,user:B},403);
await call(C,'/api/room/'+room.id,{kind:'chat',clientId:crypto.randomUUID(),body:{text:'QA session note'}});const messages=await call(B,'/api/room/'+room.id);assert(messages.events.some(e=>e.body.text==='QA session note'));checks++;

// Connecting a room to its studio must preserve ownership and revoke only
// the room's access grant when the attachment is removed.
assert.equal(messages.projectInfo.id,project.id);checks++;
await act(C,{action:'roomProject',id:room.id,mode:'detach',expectedProject:project.id},403);
await act(D,{action:'roomProject',id:room.id,mode:'attach',expectedProject:project.id,project:project.id},403);
await act(B,{action:'roomProject',id:room.id,mode:'detach',expectedProject:null},409);
await act(B,{action:'roomProject',id:room.id,mode:'detach',expectedProject:project.id});
const detached=await call(C,'/api/room/'+room.id);assert.equal(detached.room.project,null);assert.equal(detached.projectInfo,null);checks+=2;
await act(C,{action:'projectRead',id:project.id},403);await call(C,'/api/file/'+file.id,undefined,404);
const foreignProject=await act(C,{action:'project',title:'QA member-owned project',data:{bpm:100,tracks:[]}});
await act(B,{action:'roomProject',id:room.id,mode:'attach',expectedProject:null,project:foreignProject.id},403);
await act(B,{action:'roomProject',id:room.id,mode:'attach',expectedProject:null,project:project.id});
const listening=await act(C,{action:'projectRead',id:project.id});assert.equal(listening.canEdit,false);checks++;
await call(C,'/api/file/'+file.id);
await act(C,{action:'project',title:'QA unauthorized room fork',data},403);
const emptyRoom=await act(B,{action:'room',title:'QA new room studio'});
const emptyRoomState=await call(B,'/api/room/'+emptyRoom.id);
await act(C,{action:'joinRoom',id:emptyRoom.id,invite:emptyRoomState.room.invite});
await act(C,{action:'roomProject',id:emptyRoom.id,mode:'create',expectedProject:null},403);
const beforeCreate=await call(B,'/api/state');
const createRace=await Promise.all([1,2].map(()=>fetch(base+'/api/action',{method:'POST',headers:{...headers(B),'Content-Type':'application/json'},body:JSON.stringify({action:'roomProject',id:emptyRoom.id,mode:'create',expectedProject:null})})));
assert.deepEqual(createRace.map(r=>r.status).sort(),[200,409]);checks++;
await Promise.all(createRace.map(r=>r.text()));
const createdRoom=await call(B,'/api/room/'+emptyRoom.id),createdId=createdRoom.room.project;
assert(createdId);assert.equal(createdRoom.projectInfo.id,createdId);checks+=2;
const afterCreate=await call(B,'/api/state');assert.equal(afterCreate.projects.length,beforeCreate.projects.length+1);checks++;
const createdProject=await act(B,{action:'projectRead',id:createdId});assert.equal(createdProject.canEdit,true);assert.deepEqual(createdProject.data,{bpm:92,tracks:[]});checks+=2;
await act(C,{action:'projectRead',id:createdId});
await act(C,{action:'project',id:createdId,title:'QA forbidden edit',data:{bpm:120,tracks:[]}},403);
await act(B,{action:'roomProject',id:emptyRoom.id,mode:'create',expectedProject:null},409);
await act(B,{action:'roomProject',id:emptyRoom.id,mode:'attach',expectedProject:createdId,project:project.id});
await act(C,{action:'projectRead',id:createdId},403);
await act(B,{action:'roomProject',id:emptyRoom.id,mode:'detach',expectedProject:project.id});
await call(C,'/api/file/'+file.id); // The original room still grants access.
await act(B,{action:'closeRoom',id:emptyRoom.id});
await act(B,{action:'roomProject',id:emptyRoom.id,mode:'create',expectedProject:null},403);
await act(B,{action:'deleteProject',id:createdId});await act(C,{action:'deleteProject',id:foreignProject.id});

const ownerVersion=await act(B,{action:'projectRead',id:project.id});
assert.equal(ownerVersion.canEdit,true);checks++;
assert.equal(ownerVersion.revision,1);checks++;
const update=await act(B,{action:'project',id:project.id,title:'QA revised',data,baseRevision:1});assert.equal(update.revision,2);checks++;
await act(B,{action:'project',id:project.id,title:'QA stale',data,baseRevision:1},409);
const versions=await act(B,{action:'projectVersions',id:project.id});assert.equal(versions.length,2);checks++;
await act(C,{action:'projectVersions',id:project.id},404);
await act(B,{action:'project',id:project.id,title:'QA removed source',data:{bpm:92,tracks:[]},baseRevision:2});
await call(B,'/api/file/'+file.id);
await act(B,{action:'project',id:project.id,title:'QA restore source',data,baseRevision:3});
const races=await Promise.all(['First save','Second save'].map(title=>fetch(base+'/api/action',{method:'POST',headers:{...headers(B),'Content-Type':'application/json'},body:JSON.stringify({action:'project',id:project.id,title,data,baseRevision:4})})));
assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);checks++;
await act(B,[],400);
await act(B,{action:'project',title:'Invalid null track',data:{bpm:92,tracks:[null]}},400);
await act(B,{action:'project',title:'Missing gain',data:{bpm:92,tracks:[{...data.tracks[0],volume:undefined}]}},400);
await act(B,{action:'project',id:project.id,title:'QA invalid tempo',data:{...data,bpm:900},baseRevision:2},400);
await act(B,{action:'project',id:project.id,title:'QA invalid automation',data:{...data,tracks:[{...data.tracks[0],automation:[{time:1,value:99}]}]},baseRevision:2},400);
const rtc=await call(B,'/api/rtc?room='+room.id);assert.equal(rtc.relay,false);assert.equal(rtc.iceServers[0].urls,'stun:stun.cloudflare.com:3478');checks+=2;
await call(D,'/api/rtc?room='+room.id,undefined,403);await call(null,'/api/rtc',undefined,401);
const sB=crypto.randomUUID(),sC=crypto.randomUUID(),sC2=crypto.randomUUID();
await call(B,'/api/room/'+room.id,{kind:'startMedia',session:sB});await call(C,'/api/room/'+room.id,{kind:'startMedia',session:sC});
for(const [id,session]of[[B,sB],[C,sC]]){
  const own=await call(id,'/api/room/'+room.id+'?session='+session);
  assert.equal(own.mediaReplaced,false);assert.equal(own.mediaMissing,false);
  assert(own.sessions.some(s=>s.user===B&&s.session===sB));assert(own.sessions.some(s=>s.user===C&&s.session===sC));checks+=4;
}
const event={kind:'signal',clientId:crypto.randomUUID(),recipient:C,body:{senderSession:sB,recipientSession:sC,description:{type:'offer',sdp:'v=0'}}};
await call(B,'/api/room/'+room.id,event);await call(B,'/api/room/'+room.id,event);
const delivered=await call(C,'/api/room/'+room.id+'?session='+sC);assert.equal(delivered.events.filter(e=>e.clientId===event.clientId).length,1);checks++;
const observer=await call(C,'/api/room/'+room.id);assert(!observer.events.some(e=>e.kind==='signal'));checks++;
assert.equal(observer.mediaReplaced,false);assert.equal(observer.mediaMissing,false);checks+=2;
await call(C,'/api/room/'+room.id,{kind:'startMedia',session:sC2});
const stale=await call(C,'/api/room/'+room.id+'?session='+sC);assert.equal(stale.mediaReplaced,true);checks++;
assert.equal(stale.mediaMissing,false);checks++;
await call(B,'/api/room/'+room.id,{...event,clientId:crypto.randomUUID()},409);
await call(C,'/api/room/'+room.id,{kind:'stopMedia',session:sC});
const stillActive=await call(C,'/api/room/'+room.id+'?session='+sC2);assert(stillActive.sessions.some(s=>s.user===C&&s.session===sC2));checks++;
assert.equal(stillActive.mediaReplaced,false);assert.equal(stillActive.mediaMissing,false);checks+=2;
const currentEvent={...event,clientId:crypto.randomUUID(),body:{...event.body,recipientSession:sC2}};await call(B,'/api/room/'+room.id,currentEvent);
const restart={kind:'signal',clientId:crypto.randomUUID(),recipient:C,body:{senderSession:sB,recipientSession:sC2,restart:true}};
await call(B,'/api/room/'+room.id,restart);const recoveryMessages=await call(C,'/api/room/'+room.id+'?session='+sC2);assert(recoveryMessages.events.some(e=>e.clientId===restart.clientId&&e.body.restart===true));checks++;
await call(C,'/api/room/'+room.id,{kind:'stopMedia',session:sC2});await call(B,'/api/room/'+room.id,{...currentEvent,clientId:crypto.randomUUID()},409);
for(const session of [sC2,crypto.randomUUID()]){
  const ended=await call(C,'/api/room/'+room.id+'?session='+session);
  assert.equal(ended.mediaReplaced,false);assert.equal(ended.mediaMissing,true);
  assert(!ended.sessions.some(s=>s.user===C));checks+=3;
}
const otherStillActive=await call(B,'/api/room/'+room.id+'?session='+sB);
assert.equal(otherStillActive.mediaReplaced,false);assert.equal(otherStillActive.mediaMissing,false);checks+=2;
await call(C,'/api/room/'+room.id,{kind:'chat',body:{text:'missing identity'}},400);
const myFiles=await act(A,{action:'myFiles'});assert(myFiles.some(f=>f.id===file.id));checks++;
const exported=await act(A,{action:'exportData'});assert(exported.files.some(f=>f.id===file.id));assert(!exported.projects.some(p=>p.owner===B));checks+=2;
await act(B,{action:'eraseFile',id:file.id,confirm:'ERASE'},404);await act(A,{action:'eraseFile',id:file.id,confirm:'NO'},400);
await act(B,{action:'rotateInvite',id:room.id});await act(D,{action:'joinRoom',id:room.id,invite:roomData.room.invite},403);await act(B,{action:'removeMember',id:room.id,user:C});await call(C,'/api/file/'+file.id,undefined,404);await act(C,{action:'projectRead',id:project.id},403);await call(C,'/api/room/'+room.id,undefined,403);await act(B,{action:'closeRoom',id:room.id});await call(B,'/api/room/'+room.id,undefined,403);
await act(A,{action:'eraseFile',id:file.id,confirm:'ERASE'});await call(A,'/api/file/'+file.id,undefined,404);await call(B,'/api/file/'+file.id,undefined,404);await act(B,{action:'deleteProject',id:project.id});
const bad=new FormData();bad.set('purpose','avatar');bad.set('file',new File(['<script>alert(1)</script>'],'bad.png',{type:'image/png'}));const bu=await fetch(base+'/api/upload',{method:'POST',headers:headers(A),body:bad});assert.equal(bu.status,400);checks++;
console.log(`${checks} API checks passed: privacy, revision conflicts, saved versions, room-session identity, deduplicated signals, stale-session rejection, data export, permanent file erasure, and existing v1 permissions.`);
const fs=await import('node:fs/promises');await fs.writeFile(new URL('./qa-result.json',import.meta.url),JSON.stringify({checks,users:[A,B,C,D],file:file.id,passed:true},null,2));

