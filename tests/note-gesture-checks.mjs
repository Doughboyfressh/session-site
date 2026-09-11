import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {loadTS}=await import(pathToFileURL(path.resolve('tests/load-ts.mjs')));
const {editNotes,checkNotes,applyNotePatch}=loadTS('lib/note-edit.ts');
const {defaults}=loadTS('lib/audio.ts');
let checks=0,passed=0;const failures=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const near=(a,b)=>{assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);checks++;};
const reject=(fn,rx)=>{assert.throws(fn,rx);checks++;};
function scenario(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message);}}
const note=(id,patch={})=>({id,pitch:60,start:2,length:0.5,velocity:0.75,...patch});
const track=(patch={})=>({...defaults('Keys'),notes:[note('a'),note('b',{pitch:64,start:2.125,length:1.25}),note('c',{pitch:12,start:5,length:2})],sound:'keys',duration:8,peaks:[0.1,0.2],...patch});
const ids=t=>t.notes.map(n=>n.id);
const drag=(beats=0,semitones=0)=>({kind:'drag',beats,semitones});
const resize=beats=>({kind:'resize',beats});
function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;}
function unchanged(fn,input){const before=structuredClone(input);const result=fn();eq(input,before,'Source must not change');return result;}

scenario('Combined drag changes time and pitch in one result preserving all other fields',()=>{
 const t=freeze(track());const out=unchanged(()=>editNotes(t,120,['b','a'],drag(1.5,-12)),t);
 eq(out.notes.map(n=>[n.start,n.pitch]),[[3.5,48],[3.625,52],[5,12]]);eq(out.selected,['b','a']);
 for(const i of [0,1])eq({...out.notes[i],start:t.notes[i].start,pitch:t.notes[i].pitch},t.notes[i]);
 ok(out.notes[2]===t.notes[2]);ok(out.notes[0]!==t.notes[0]);ok(out.notes!==t.notes);
});
scenario('Drag moves selected hidden pitches as part of the same chord',()=>{
 const t=freeze(track());const out=editNotes(t,120,['a','c'],drag(-1,12));
 eq(out.notes.map(n=>[n.start,n.pitch]),[[1,72],[2.125,64],[4,24]]);ok(out.notes[1]===t.notes[1]);
});
scenario('Relative resize preserves unequal lengths and all starts including hidden notes',()=>{
 const t=freeze(track());const out=unchanged(()=>editNotes(t,120,ids(t),resize(0.25)),t);
 eq(out.notes.map(n=>n.length),[0.75,1.5,2.25]);
 for(let i=0;i<3;i++)eq({...out.notes[i],length:t.notes[i].length},t.notes[i]);
 const smaller=editNotes(t,120,['a','c'],resize(-0.25));eq(smaller.notes.map(n=>n.length),[0.25,1.25,1.75]);
});
scenario('Drag and resize no-ops reuse note array but copy selection',()=>{
 const t=freeze(track()),chosen=['b','a'];
 for(const edit of [drag(0,0),drag(-0,-0),resize(0),resize(-0)]){
  const out=editNotes(t,120,chosen,edit);ok(out.notes===t.notes);eq(out.selected,chosen);ok(out.selected!==chosen);
 }
});
scenario('All invalid numeric drag and resize arguments are rejected',()=>{
 const t=freeze(track());
 for(const beats of [NaN,Infinity,-Infinity,256.001,-256.001,undefined,null,'1']){
  unchanged(()=>reject(()=>editNotes(t,120,['a'],{kind:'drag',beats,semitones:1})),t);
  unchanged(()=>reject(()=>editNotes(t,120,['a'],resize(beats))),t);
 }
 for(const semitones of [NaN,Infinity,-Infinity,127.1,-128,128,0.25,undefined,null,'1'])
  unchanged(()=>reject(()=>editNotes(t,120,['a'],{kind:'drag',beats:1,semitones})),t);
});
scenario('Malformed source and selection identities reject both operations',()=>{
 for(const edit of [drag(1,1),resize(0.25)]){
  const t=freeze(track());
  for(const selected of [[],['missing'],['a','missing'],['a','a']])reject(()=>editNotes(t,120,selected,edit));
  for(const notes of [[note('a'),note('a')],[note('')],[note(undefined)],[note(2)]])
   reject(()=>editNotes(track({notes}),120,[notes[0].id],edit));
  for(const patch of [{notes:undefined},{fileId:'file'},{sequence:[[0]]},{demo:'demo'}])
   reject(()=>editNotes(track(patch),120,['a'],edit));
 }
});
scenario('Invalid tempo and malformed source notes reject even no-op gestures',()=>{
 for(const edit of [drag(),resize(0)]){
  for(const bpm of [39,241,NaN,Infinity])reject(()=>editNotes(track(),bpm,['a'],edit));
  for(const patch of [{pitch:60.1},{length:0},{start:257},{velocity:NaN}])
   reject(()=>editNotes(track({notes:[note('a',patch)]}),120,['a'],edit));
 }
});
scenario('Pitch boundary failure rejects the whole time-and-pitch drag including hidden member',()=>{
 for(const [notes,edit] of [
  [[note('a',{pitch:120}),note('hidden',{pitch:127})],drag(1,1)],
  [[note('a',{pitch:12}),note('hidden',{pitch:0})],drag(1,-1)]]){
  const t=freeze(track({notes}));unchanged(()=>reject(()=>editNotes(t,120,ids(t),edit),/entire selection/),t);
 }
 const t=track({notes:[note('a',{pitch:0})]});eq(editNotes(t,120,['a'],drag(1,127)).notes[0].pitch,127);
 const reverse=track({notes:[note('a',{pitch:127})]});eq(editNotes(reverse,120,['a'],drag(1,-127)).notes[0].pitch,0);
});
scenario('Start boundary failure rejects pitch changes too and exact boundaries remain available',()=>{
 for(const [notes,edit] of [
  [[note('a',{start:0}),note('b',{start:2})],drag(-0.25,12)],
  [[note('a',{start:254}),note('b',{start:255.75})],drag(0.5,-12)]]){
  const t=freeze(track({notes}));unchanged(()=>reject(()=>editNotes(t,240,ids(t),edit),/entire selection/),t);
 }
 const t=track({notes:[note('a',{start:0,pitch:0})]});eq(editNotes(t,240,['a'],drag(256,127)).notes[0].start,256);
 const end=track({notes:[note('a',{start:256,pitch:127})]});eq(editNotes(end,240,['a'],drag(-256,-127)).notes[0].start,0);
});
scenario('Resize rejects an entire chord if any selected duration crosses a bound',()=>{
 for(const [lengths,delta] of [[[0.1,2],-0.25],[[1,31.75],0.5],[[0.01,1],-0.01],[[1,32],0.01]]){
  const t=freeze(track({notes:lengths.map((length,i)=>note('n'+i,{length}))}));
  unchanged(()=>reject(()=>editNotes(t,120,ids(t),resize(delta)),/0.01|instrument note/),t);
 }
 const max=track({notes:[note('a',{length:31.75})]});eq(editNotes(max,120,['a'],resize(0.25)).notes[0].length,32);
 const min=track({notes:[note('a',{length:0.02})]});near(editNotes(min,120,['a'],resize(-0.01)).notes[0].length,0.01);
});
scenario('Decimal arithmetic permits a mathematically exact minimum duration',()=>{
 const t=freeze(track({notes:[note('a',{length:2.01}),note('b',{length:2.25})]}));
 const out=unchanged(()=>editNotes(t,120,ids(t),resize(-2)),t);near(out.notes[0].length,0.01);near(out.notes[1].length,0.25);
});
scenario('Real values beyond duration bounds are rejected rather than normalized into range',()=>{
 const short=freeze(track({notes:[note('a',{length:2.01})]}));
 reject(()=>editNotes(short,120,['a'],resize(-2.000001)));
 const long=freeze(track({notes:[note('a',{length:31.99})]}));
 reject(()=>editNotes(long,120,['a'],resize(0.010001)));
});
scenario('256-note capacity remains unchanged for drag and resize',()=>{
 const t=freeze(track({notes:Array.from({length:256},(_,i)=>note('n'+i,{start:i/4,pitch:i%128}))}));
 for(const edit of [drag(1,0),resize(0.25)]){const out=editNotes(t,240,ids(t),edit);eq(out.notes.length,256);eq(new Set(out.notes.map(n=>n.id)).size,256);}
 const oversized=track({notes:[...t.notes,note('extra')]});for(const edit of [drag(),resize(0)])reject(()=>editNotes(oversized,240,ids(oversized),edit),/256/);
});
scenario('Trim and split allow pitch-only drag and no-ops while rejecting all timing gestures',()=>{
 for(const patch of [{trimStart:0.25},{trimEnd:0.25},{splitFrom:'original'},{trimStart:0.25,trimEnd:0.25,splitFrom:'original'}]){
  const t=freeze(track(patch));const out=editNotes(t,120,ids(t),drag(0,1));eq(out.notes.map(n=>n.pitch),[61,65,13]);
  for(const edit of [drag(0.25,0),drag(0.25,1),resize(0.25),resize(-0.25)])
   unchanged(()=>reject(()=>editNotes(t,120,ids(t),edit),/untrimmed, unsplit/),t);
  for(const edit of [drag(),resize(0)])ok(editNotes(t,120,ids(t),edit).notes===t.notes);
 }
});
scenario('Project offset plus generated source duration includes the half-second tail',()=>{
 const t=freeze(track({offset:12,notes:[note('a',{start:255.5,length:32})]}));
 const atLimit=editNotes(t,60,['a'],drag(0,1));eq(atLimit.notes[0].pitch,61);
 unchanged(()=>reject(()=>editNotes(t,60,['a'],drag(0.25,1)),/five-minute/),t);
 const short=freeze(track({offset:12,notes:[note('a',{start:256,length:31.5})]}));
 unchanged(()=>reject(()=>editNotes(short,60,['a'],resize(0.25)),/five-minute/),short);
});
scenario('Source duration bound is independent of trims and cached duration',()=>{
 const long=freeze(track({duration:0.1,notes:[note('a',{start:200,length:1})]}));
 for(const edit of [drag(0,1),resize(0.25)])reject(()=>editNotes(long,40,['a'],edit),/five-minute/);
 const trimmed=track({...long,trimStart:100});reject(()=>editNotes(trimmed,40,['a'],drag(0,1)),/five-minute/);
 const small=track({duration:300,offset:295.5,notes:[note('a',{start:0,length:1})]});
 eq(editNotes(small,120,['a'],drag(0,1)).notes[0].pitch,61);
 reject(()=>editNotes({...small,offset:295.501},120,['a'],drag(0,1)),/five-minute/);
});
scenario('Gesture can repair a too-long original timeline without mutating its source',()=>{
 const t=freeze(track({offset:290,notes:[note('a',{start:18,length:2})]}));
 reject(()=>checkNotes(t,120,t.notes),/five-minute/);
 const moved=unchanged(()=>editNotes(t,120,['a'],drag(-4,12)),t);eq(moved.notes[0].start,14);eq(moved.notes[0].pitch,72);
 const shorter=unchanged(()=>editNotes(t,120,['a'],resize(-1)),t);eq(shorter.notes[0].length,1);
});
scenario('Frozen-snapshot gesture preview does not compound deltas',()=>{
 const t=freeze(track());const initial=editNotes(t,120,['a','b'],drag(0.25,1));
 const later=editNotes(t,120,['a','b'],drag(0.5,2));const back=editNotes(t,120,['a','b'],drag());
 eq(later.notes[0].start,2.5);eq(later.notes[0].pitch,62);ok(back.notes===t.notes);eq(initial.notes[0].start,2.25);
});
scenario('A committed gesture preserves current mixer state and unrelated tracks',()=>{
 const original=freeze(track()),other=freeze(track({id:'other'}));
 const current=freeze({...original,volume:0.25,pan:0.4,fadeIn:2,automation:[{time:0,value:0.4}]});
 const data=freeze({bpm:120,tracks:[current,other]});const edited=editNotes(original,120,['a','b'],drag(1,2));
 const next=unchanged(()=>applyNotePatch(data,120,original,{notes:edited.notes}),data);
 eq(next.tracks[0].volume,0.25);eq(next.tracks[0].pan,0.4);eq(next.tracks[0].fadeIn,2);eq(next.tracks[0].automation,current.automation);
 ok(next.tracks[1]===other);eq(next.tracks[0].duration,undefined);eq(next.tracks[0].peaks,undefined);eq(next.tracks[0].notes,edited.notes);
});
scenario('Commit refuses stale source and tempo snapshots',()=>{
 const t=freeze(track()),edit=editNotes(t,120,['a'],drag(1,1));
 for(const patch of [{notes:[...t.notes,note('new')]},{notes:t.notes.map((n,i)=>i? n:{...n,velocity:0.8})},{sound:'bass'},{offset:1},{trimStart:1},{trimEnd:1},{splitFrom:'ancestor'},{fileId:'file'},{sequence:[[0]]},{demo:'x'}])
  reject(()=>applyNotePatch({bpm:120,tracks:[{...t,...patch}]},120,t,{notes:edit.notes}),/changed/);
 reject(()=>applyNotePatch({bpm:121,tracks:[t]},120,t,{notes:edit.notes}),/changed/);
 reject(()=>applyNotePatch({bpm:120,tracks:[]},120,t,{notes:edit.notes}),/changed/);
});
scenario('Commit checks final project capacity and size after note geometry',()=>{
 const t=track();const edited=editNotes(t,120,['a'],drag(1,1));
 const tracks=Array.from({length:32},(_,i)=>track({id:'t'+i}));tracks[0]=t;
 eq(applyNotePatch({bpm:120,tracks},120,t,{notes:edited.notes}).tracks.length,32);
 reject(()=>applyNotePatch({bpm:120,tracks:[...tracks,track({id:'extra'})]},120,t,{notes:edited.notes}),/32/);
 const huge=track({id:'huge',notes:[note('x'.repeat(250000))]});
 reject(()=>applyNotePatch({bpm:120,tracks:[t,huge]},120,t,{notes:edited.notes}),/too large/);
});
scenario('Longer and shorter source extents clear only fadeEnd on commit',()=>{
 for(const edit of [drag(2,1),drag(-2,1),resize(2),resize(-0.5)]){
  const t=freeze(track({notes:[note('a',{start:10,length:1})],fadeStart:1,fadeEnd:5.5,fadeIn:1.25,fadeOut:1.5,automation:[{time:1,value:0.75}]}));
  const notes=editNotes(t,120,['a'],edit).notes;const next=applyNotePatch({bpm:120,tracks:[t]},120,t,{notes}).tracks[0];
  eq(next.fadeEnd,undefined);eq(next.fadeStart,1);eq(next.fadeIn,1.25);eq(next.fadeOut,1.5);eq(next.automation,t.automation);
 }
});
scenario('Interior and floor-limited edits preserve fadeEnd',()=>{
 for(const [notes,selected,edit] of [
  [[note('a'),note('anchor',{start:12,length:2})],['a'],drag(1,1)],
  [[note('a'),note('anchor',{start:12,length:2})],['a'],resize(1)],
  [[note('a')],['a'],drag(1,1)],
  [[note('a')],['a'],resize(1)],
  [[note('a',{start:10})],['a'],drag(0,1)]]){
  const t=track({notes,fadeStart:1,fadeEnd:3});const next=applyNotePatch({bpm:120,tracks:[t]},120,t,{notes:editNotes(t,120,selected,edit).notes}).tracks[0];
  eq(next.fadeEnd,3);eq(next.fadeStart,1);
 }
});
scenario('Pitch-only trimmed or split commits preserve fade anchors',()=>{
 for(const patch of [{trimStart:0.5},{trimEnd:0.5},{splitFrom:'ancestor'}]){
  const t=track({...patch,fadeStart:1,fadeEnd:3,fadeIn:1,fadeOut:2});
  const next=applyNotePatch({bpm:120,tracks:[t]},120,t,{notes:editNotes(t,120,ids(t),drag(0,2)).notes}).tracks[0];
  for(const key of ['fadeStart','fadeEnd','fadeIn','fadeOut','trimStart','trimEnd','splitFrom'])eq(next[key],t[key]);
 }
});
scenario('Commit revalidates direct invalid note patches',()=>{
 const t=track();for(const patch of [{length:32.1},{start:-1},{pitch:128},{length:0.009}])
  reject(()=>applyNotePatch({bpm:120,tracks:[t]},120,t,{notes:[note('a',patch)]}));
 const trimmed=track({trimEnd:1});reject(()=>applyNotePatch({bpm:120,tracks:[trimmed]},120,trimmed,{notes:trimmed.notes.map(n=>({...n,length:n.length+1}))}),/untrimmed/);
});
scenario('Chord property checks preserve relative time, pitch and length for varying selections',()=>{
 for(let count=1;count<=12;count++){
  const t=freeze(track({notes:Array.from({length:count},(_,i)=>note('n'+i,{start:2+i/8,pitch:40+i,length:0.5+i/4,velocity:(i+1)/127}))}));
  const chosen=ids(t).filter((_,i)=>i%2===0);const chosenSet=new Set(chosen);
  for(const edit of [drag(0.25,7),drag(-0.25,-7),resize(0.25),resize(-0.25)]){
   const out=unchanged(()=>editNotes(t,120,chosen,edit),t);eq(out.selected,chosen);
   for(let i=0;i<count;i++){
    const src=t.notes[i],dest=out.notes[i];eq(dest.id,src.id);eq(dest.velocity,src.velocity);
    if(!chosenSet.has(src.id)){ok(dest===src);continue;}
    near(dest.start,src.start+(edit.kind==='drag'?edit.beats:0));
    eq(dest.pitch,src.pitch+(edit.kind==='drag'?edit.semitones:0));
    near(dest.length,src.length+(edit.kind==='resize'?edit.beats:0));
   }
  }
 }
});
console.log(JSON.stringify({checks,passed,failed:failures.length,failures},null,2));
if(failures.length)process.exitCode=1;
