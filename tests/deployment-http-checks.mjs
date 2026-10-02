// Explicit synthetic-account check against an already running Vercel runtime.
// Generated accounts use example.invalid; no mail, personal files, or real users.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import {S3Client,DeleteObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {loadTS} from './load-ts.mjs';
const {originalArrangement}=loadTS('lib/originals.ts');
const {editNotes,applyNotePatch}=loadTS('lib/note-edit.ts');
const base = process.env.SESSION_VERIFY_BASE || 'http://localhost:3101';
const tag = crypto.randomBytes(4).toString('hex');
const actors = [];
const createdFiles = [];
const createdUploads = [];
const allowedFiles = [];
const audioFixture = {name:'synthetic.wav',purpose:'audio',size:6*1024*1024};
const pluginClassId = '0123456789abcdef0123456789abcdef';
const pluginState = {version:1,format:'vst3',classId:pluginClassId,component:'',controller:''};
const pluginStateBytes = new TextEncoder().encode(JSON.stringify(pluginState));
const pluginStateFixture = {name:`synthetic-plugin-state-${tag}.json`,purpose:'plugin-state',size:pluginStateBytes.byteLength};
let checks = 0;
function check(value, message) { assert.ok(value,message); checks++; }
async function request(actor, pathname, options = {}, expected = 200) {
  const headers = new Headers(options.headers);
  headers.set('origin',base);
  if (actor?.cookie) headers.set('cookie',actor.cookie);
  const response = await fetch(base + pathname,{...options,headers});
  for (const cookie of response.headers.getSetCookie()) {
    if (actor) {
      const pair=cookie.split(';')[0], name=pair.split('=')[0];
      actor.jar.set(name,pair);
      actor.cookie=[...actor.jar.values()].join('; ');
    }
  }
  if (expected !== undefined) { assert.equal(response.status,expected,`${pathname}: ${await response.clone().text()}`); checks++; }
  return response;
}
async function json(actor,path,body,expected=200) {
  return (await request(actor,path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},expected)).json();
}
const action=(actor,body,status)=>json(actor,'/api/action',body,status);
async function signup(suffix) {
  const actor={jar:new Map(),password:crypto.randomBytes(24).toString('hex')};
  const result=await json(actor,'/api/auth/sign-up/email',{email:`session-check-${tag}-${suffix}@example.invalid`,
    password:actor.password,name:'Disposable deployment check'});
  actor.id=result.user.id; actors.push(actor);
  fs.mkdirSync('outputs',{recursive:true});
  fs.writeFileSync('outputs/deployment-test-accounts.json',JSON.stringify(actors.map(a=>({id:a.id}))));
  check(!!actor.cookie,'sign-up created a signed session cookie');
  return actor;
}
let room, project;
try {
  const alice=await signup('a'), bob=await signup('b');
  allowedFiles.push({...audioFixture,owner:alice.id},{...pluginStateFixture,owner:alice.id});
  const session=await (await request(alice,'/api/auth/get-session')).json();
  check(session.user.id===alice.id,'server verified Neon session');
  await action(alice,{action:'profile',username:'session_'+tag+'_a',name:'Deployment check',roles:['Producer'],visibility:'private'});
  await action(bob,{action:'profile',username:'session_'+tag+'_a',name:'Duplicate check',roles:['Artist'],visibility:'private'},400);
  await action(bob,{action:'profile',username:'session_'+tag+'_b',name:'Second deployment check',roles:['Artist'],visibility:'private'});
  const forge=await request(null,'/api/action',{method:'POST',headers:{'content-type':'application/json',
    'oai-authenticated-user-id':alice.id,'oai-authenticated-user-email':'forged@example.invalid'},body:'{}'},401);
  check((await forge.json()).error.includes('Sign in'),'forged Sites identity was ignored');
  await json(alice,'/api/upload-session',{operation:'start',name:'bad.wav',purpose:'constructor',size:500*1024*1024},413);
  const length=audioFixture.size, wav=new Uint8Array(length), view=new DataView(wav.buffer);
  const word=(at,text)=>[...text].forEach((c,i)=>wav[at+i]=c.charCodeAt(0));
  word(0,'RIFF');view.setUint32(4,length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,length-44,true);
  const upload=await json(alice,'/api/upload-session',{operation:'start',...audioFixture});
  createdUploads.push({...upload,owner:alice.id});
  fs.writeFileSync('outputs/deployment-test-uploads.json',JSON.stringify(createdUploads));
  await request(bob,`/api/upload-session?id=${upload.id}&part=0`,{method:'PUT',body:wav.slice(0,upload.chunkSize)},404);
  for (let part=0;part<upload.parts;part++) await request(alice,`/api/upload-session?id=${upload.id}&part=${part}`,
    {method:'PUT',body:wav.slice(part*upload.chunkSize,(part+1)*upload.chunkSize)});
  const file=await json(alice,'/api/upload-session',{operation:'complete',id:upload.id});
  createdFiles.push({id:file.id,actor:alice,...audioFixture});
  check(!!file.id,'6 MiB upload passed chunking and actual S3 storage');
  await request(bob,'/api/file/'+file.id,{},404);
  await request(null,'/api/file/'+file.id,{},404);
  const range=await request(alice,'/api/file/'+file.id,{headers:{range:'bytes=0-43'}},206);
  check((await range.arrayBuffer()).byteLength===44,'authorized storage range read');
  project=await action(alice,{action:'project',title:'Deployment fixture',creation:{key:crypto.randomUUID(),checkpoint:true},
    data:{bpm:92,tracks:[{id:'fixture-track',name:'Synthetic audio',fileId:file.id,volume:1,pan:0,offset:0,
      trimStart:0,trimEnd:0,low:0,mid:0,high:0,muted:false,solo:false}]}});
  check(project.revision===1,'atomic first-save receipt and source links');
  await action(bob,{action:'projectRead',id:project.id},403);
  const state=await (await request(alice,'/api/state')).json();
  check(state.projects[0].bpm===92 && state.projects[0].trackCount===1,'PostgreSQL JSON summaries have numeric fields');
  // State and frozen audio remain separate private files, linked by the actual PostgreSQL save.
  const stateUpload=await json(alice,'/api/upload-session',{operation:'start',...pluginStateFixture});
  createdUploads.push({...stateUpload,owner:alice.id});
  fs.writeFileSync('outputs/deployment-test-uploads.json',JSON.stringify(createdUploads));
  for(let part=0;part<stateUpload.parts;part++) await request(alice,`/api/upload-session?id=${stateUpload.id}&part=${part}`,
    {method:'PUT',body:pluginStateBytes.slice(part*stateUpload.chunkSize,(part+1)*stateUpload.chunkSize)});
  const stateFile=await json(alice,'/api/upload-session',{operation:'complete',id:stateUpload.id});
  createdFiles.push({id:stateFile.id,actor:alice,...pluginStateFixture});
  check(!!stateFile.id,'private VST3 state passed chunked upload and actual object storage');
  const notes=[{id:'fixture-vst3-note',pitch:60,start:0,length:1,velocity:0.75}];
  const pluginBpm=120, noteLoopBeats=8;
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify([1,pluginClassId,stateFile.id,pluginBpm,noteLoopBeats,
    notes.map(({pitch,start,length,velocity})=>[pitch,start,length,velocity])])).digest('hex');
  const nativePlugin={version:1,format:'vst3',classId:pluginClassId,name:'Synthetic VST3',vendor:'SESSION fixture',
    stateFileId:stateFile.id,freeze:{fileId:file.id,fingerprint}};
  const pluginTrack={id:'fixture-vst3-track',name:'Synthetic VST3 score',plugin:nativePlugin,notes,noteLoopBeats,
    volume:1,pan:0,offset:0,trimStart:0,trimEnd:0,low:0,mid:0,high:0,muted:false,solo:false};
  const pluginArrangement={bpm:pluginBpm,tracks:[pluginTrack]};
  const pluginProject=await action(alice,{action:'project',title:'Disposable VST3 state check',
    creation:{key:crypto.randomUUID(),checkpoint:true},data:pluginArrangement});
  check(pluginProject.revision===1,'VST3 first save linked private state and existing frozen audio');
  const reopenedPlugin=await action(alice,{action:'projectRead',id:pluginProject.id});
  check(JSON.stringify(reopenedPlugin.data)===JSON.stringify(pluginArrangement),
    'actual PostgreSQL save/reopen preserves VST3 settings, state/freeze references and editable notes');
  await action(bob,{action:'projectRead',id:pluginProject.id},403);
  for(const actor of [null,bob]) for(const method of ['GET','HEAD'])
    await request(actor,'/api/file/'+stateFile.id,{method},404);
  const stateRead=await request(alice,'/api/file/'+stateFile.id);
  check(stateRead.headers.get('content-type')==='application/vnd.session.vst3-state+json',
    'owner reads plugin state with its private JSON MIME type');
  check(stateRead.headers.get('cache-control')==='private, no-store','plugin state is never publicly cached');
  check(JSON.stringify(await stateRead.json())===JSON.stringify(pluginState),'owner reads the exact uploaded VST3 state JSON');
  const stateHead=await request(alice,'/api/file/'+stateFile.id,{method:'HEAD'});
  check(Number(stateHead.headers.get('content-length'))===pluginStateFixture.size && (await stateHead.arrayBuffer()).byteLength===0,
    'owner HEAD returns state metadata without a body');
  await action(alice,{action:'project',title:'Reject audio used as VST3 state',
    data:{...pluginArrangement,tracks:[{...pluginTrack,plugin:{...nativePlugin,stateFileId:file.id,freeze:undefined}}]}},403);
  await action(alice,{action:'project',title:'Reject VST3 state used as frozen audio',
    data:{...pluginArrangement,tracks:[{...pluginTrack,plugin:{...nativePlugin,stateFileId:undefined,
      freeze:{fileId:stateFile.id,fingerprint}}}]}},403);
  const score=originalArrangement('demo-original-v1-12-1');
  const stem=score.tracks.find(t=>t.notes);
  const edited=applyNotePatch(score,score.bpm,stem,{notes:editNotes(stem,score.bpm,[stem.notes[0].id],{kind:'delete'}).notes});
  const originalProject=await action(alice,{action:'project',title:'Disposable Originals check',creation:{key:crypto.randomUUID(),checkpoint:true},data:edited});
  const reopened=await action(alice,{action:'projectRead',id:originalProject.id});
  check(JSON.stringify(reopened.data)===JSON.stringify(edited),'actual PostgreSQL save/reopen preserves editable original score, loop lengths and placements');
  await action(bob,{action:'projectRead',id:originalProject.id},403);
  for(const id of ['demo-original-v1-12-1','demo-original-v1-24-2','demo-1']) {
    const page=await (await request(null,'/t/'+id)).text();
    check(page.includes('SESSION Originals') && !page.includes('This track is private or unavailable.'),'public original permalink resolves '+id);
  }
  room=await action(alice,{action:'room',title:'Disposable check room',visibility:'invite'});
  await action(alice,{action:'roomProject',id:room.id,mode:'attach',project:project.id,expectedProject:null});
  await action(alice,{action:'roomProject',id:room.id,mode:'detach',expectedProject:project.id});
  const roomResponse=await request(alice,'/api/room/'+room.id);
  check(roomResponse.ok,'room seen timestamp uses PostgreSQL GREATEST');
  // Leave one partial upload so cleanup must claim a pending session and erase staging.
  const partial=await json(alice,'/api/upload-session',{operation:'start',...audioFixture});
  createdUploads.push({...partial,owner:alice.id});
  fs.writeFileSync('outputs/deployment-test-uploads.json',JSON.stringify(createdUploads));
  await request(alice,`/api/upload-session?id=${partial.id}&part=0`,{method:'PUT',body:wav.slice(0,partial.chunkSize)});
  console.log(`${checks} actual Neon Auth/PostgreSQL/private-storage HTTP checks passed.`);
} finally {
  // Cleanup is restricted to the synthetic accounts and objects created above.
  const cleanupErrors=[];
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const storage=new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true});
  const bucket=process.env.SESSION_FILES_BUCKET || 'session-files';
  async function absent(key) {
    try {
      const result=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key,Range:'bytes=0-0'}));
      result.Body?.destroy();
      throw new Error('Synthetic object still exists: '+key);
    } catch(error) {assert.equal(error.$metadata?.httpStatusCode,404,'Storage erasure must be confirmed');}
  }
  const ids=actors.map(a=>a.id);
  if (ids.length) {
    try {
      // Reconcile database-owned files even when an upload response was lost.
      const {rows:files}=await pool.query('SELECT id,owner,name,size,purpose FROM files WHERE owner=ANY($1::text[])',[ids]);
      const filesById=new Map(createdFiles.map(file=>[file.id,{...file,owner:file.actor.id}]));
      for(const file of files) {
        assert.ok(allowedFiles.some(fixture=>fixture.owner===file.owner && fixture.name===file.name &&
          fixture.size===Number(file.size) && fixture.purpose===file.purpose),'Unexpected file owned by a disposable actor; retain it for inspection');
        filesById.set(file.id,{...file,actor:actors.find(a=>a.id===file.owner)});
      }
      for(const file of filesById.values()) {
        assert.ok(file.actor);
        assert.ok(allowedFiles.some(fixture=>fixture.owner===file.owner && fixture.name===file.name &&
          fixture.size===Number(file.size) && fixture.purpose===file.purpose),'Cleanup is restricted to the exact synthetic audio/state fixtures');
        await action(file.actor,{action:'eraseFile',id:file.id,confirm:'ERASE'});
        await absent(file.id);
      }
      // Keep session snapshots so removed metadata cannot hide leftover chunks.
      const {rows:sessions}=await pool.query('SELECT id,owner,parts,status FROM upload_sessions WHERE owner=ANY($1::text[])',[ids]);
      const uploadsById=new Map(createdUploads.map(upload=>[upload.id,upload]));
      for(const upload of sessions) uploadsById.set(upload.id,upload);
      fs.writeFileSync('outputs/deployment-test-uploads.json',JSON.stringify([...uploadsById.values()]));
      for(const upload of uploadsById.values()) {
        assert.ok(ids.includes(upload.owner));assert.match(upload.id,/^[0-9a-f-]{36}$/);
        if(sessions.some(session=>session.id===upload.id)) {
          assert.ok(['pending','cleaning'].includes(upload.status),'Retain active upload for recovery: '+upload.id);
          // This claim races the API's pending-to-uploading/finalizing claims.
          const {rows:locked}=await pool.query("UPDATE upload_sessions SET status='cleaning' WHERE id=$1 AND owner=$2 AND status IN ('pending','cleaning') RETURNING id",[upload.id,upload.owner]);
          assert.equal(locked.length,1,'Upload became active; retain its actor and metadata');
        }
        const parts=Number(upload.parts);assert.ok(Number.isSafeInteger(parts)&&parts>0&&parts<=32);
        for(let part=0;part<parts;part++) {
          const key=`staging/${upload.id}/${part}`;
          await storage.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
          await absent(key);
        }
        await pool.query('DELETE FROM upload_sessions WHERE id=$1 AND owner=$2',[upload.id,upload.owner]);
      }
      for(const table of ['files','upload_sessions']) {
        const {rows}=await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE owner=ANY($1::text[])`,[ids]);
        assert.equal(rows[0].count,0,'Residual synthetic data: '+table);
      }
      console.log('Synthetic files and upload staging cleanup verified.');
    } catch(error) {cleanupErrors.push(error);console.error('Synthetic storage cleanup failed: '+error.message);}
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of ['project_versions','project_creations','projects','rooms','profiles'])
        await client.query(`DELETE FROM ${table} WHERE ${table==='profiles'?'id':'owner'} = ANY($1::text[])`,[ids]);
      await client.query('DELETE FROM members WHERE "user" = ANY($1::text[])',[ids]);
      await client.query('DELETE FROM rate_limits WHERE split_part(id,\':\',1) = ANY($1::text[])',[ids]);
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK'); cleanupErrors.push(error); console.error('Synthetic fixture cleanup failed',error.message);}
    finally {client.release();}
  }
  storage.destroy();
  await pool.end();
  if (cleanupErrors.length) {
    process.exitCode=1;
    console.error('Retained synthetic auth accounts until file/database cleanup can be completed.');
  } else {
    for (const actor of actors) {
      const result=await json(actor,'/api/auth/delete-user',{password:actor.password},undefined).catch(()=>null);
      if (!result?.success) console.log('Synthetic auth account cleanup requires provider admin: '+actor.id);
    }
  }
}
