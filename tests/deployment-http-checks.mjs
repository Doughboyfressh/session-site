// Explicit synthetic-account check against an already running Vercel runtime.
// Generated accounts use example.invalid; no mail, personal files, or real users.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
const base = process.env.SESSION_VERIFY_BASE || 'http://localhost:3101';
const tag = crypto.randomBytes(4).toString('hex');
const actors = [];
const createdFiles = [];
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
  const session=await (await request(alice,'/api/auth/get-session')).json();
  check(session.user.id===alice.id,'server verified Neon session');
  await action(alice,{action:'profile',username:'session_'+tag+'_a',name:'Deployment check',roles:['Producer'],visibility:'private'});
  await action(bob,{action:'profile',username:'session_'+tag+'_a',name:'Duplicate check',roles:['Artist'],visibility:'private'},400);
  await action(bob,{action:'profile',username:'session_'+tag+'_b',name:'Second deployment check',roles:['Artist'],visibility:'private'});
  const forge=await request(null,'/api/action',{method:'POST',headers:{'content-type':'application/json',
    'oai-authenticated-user-id':alice.id,'oai-authenticated-user-email':'forged@example.invalid'},body:'{}'},401);
  check((await forge.json()).error.includes('Sign in'),'forged Sites identity was ignored');
  await json(alice,'/api/upload-session',{operation:'start',name:'bad.wav',purpose:'constructor',size:500*1024*1024},413);
  const length=6*1024*1024, wav=new Uint8Array(length), view=new DataView(wav.buffer);
  const word=(at,text)=>[...text].forEach((c,i)=>wav[at+i]=c.charCodeAt(0));
  word(0,'RIFF');view.setUint32(4,length-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,44100,true);view.setUint32(28,88200,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,length-44,true);
  const upload=await json(alice,'/api/upload-session',{operation:'start',name:'synthetic.wav',purpose:'audio',size:length});
  await request(bob,`/api/upload-session?id=${upload.id}&part=0`,{method:'PUT',body:wav.slice(0,upload.chunkSize)},404);
  for (let part=0;part<upload.parts;part++) await request(alice,`/api/upload-session?id=${upload.id}&part=${part}`,
    {method:'PUT',body:wav.slice(part*upload.chunkSize,(part+1)*upload.chunkSize)});
  const file=await json(alice,'/api/upload-session',{operation:'complete',id:upload.id});
  createdFiles.push({id:file.id,actor:alice});
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
  room=await action(alice,{action:'room',title:'Disposable check room',visibility:'invite'});
  await action(alice,{action:'roomProject',id:room.id,mode:'attach',project:project.id,expectedProject:null});
  await action(alice,{action:'roomProject',id:room.id,mode:'detach',expectedProject:project.id});
  const roomResponse=await request(alice,'/api/room/'+room.id);
  check(roomResponse.ok,'room seen timestamp uses PostgreSQL GREATEST');
  console.log(`${checks} actual Neon Auth/PostgreSQL/private-storage HTTP checks passed.`);
} finally {
  // Cleanup is restricted to the synthetic accounts and objects created above.
  for (const file of createdFiles) await action(file.actor,{action:'eraseFile',id:file.id}).catch(()=>{});
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const ids=actors.map(a=>a.id);
  if (ids.length) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of ['project_versions','project_creations','projects','rooms','profiles','upload_sessions'])
        await client.query(`DELETE FROM ${table} WHERE ${table==='profiles'?'id':'owner'} = ANY($1::text[])`,[ids]);
      await client.query('DELETE FROM members WHERE "user" = ANY($1::text[])',[ids]);
      await client.query('DELETE FROM rate_limits WHERE split_part(id,\':\',1) = ANY($1::text[])',[ids]);
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK'); console.error('Synthetic fixture cleanup failed',error.message);}
    finally {client.release();}
  }
  await pool.end();
  for (const actor of actors) {
    const result=await json(actor,'/api/auth/delete-user',{password:actor.password},undefined).catch(()=>null);
    if (!result?.success) console.log('Synthetic auth account cleanup requires provider admin: '+actor.id);
  }
}
