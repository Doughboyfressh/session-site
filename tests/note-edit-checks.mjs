import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {loadTS}=await import(pathToFileURL(path.resolve('tests/load-ts.mjs')));
const {checkNotes,editNotes,repeatSpan,applyNotePatch}=loadTS('lib/note-edit.ts');
const {defaults}=loadTS('lib/audio.ts');
let checks=0,passed=0;const failures=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const ok=(a,m)=>{assert.ok(a,m);checks++;};
const near=(a,b)=>{assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);checks++;};
const reject=(fn,rx)=>{assert.throws(fn,rx);checks++;};
function scenario(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message);}}
const note=(id,patch={})=>({id,pitch:60,start:2,length:0.5,velocity:0.75,...patch});
const track=(patch={})=>({...defaults('Keys'),notes:[note('a'),note('b',{pitch:64}),note('c',{pitch:67,start:4,length:1})],sound:'keys',duration:8,peaks:[0.1,0.2],...patch});
function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;}
function unchanged(fn,t){const before=structuredClone(t);const result=fn();eq(t,before,'Input track must not change');return result;}
const ids=t=>t.notes.map(n=>n.id);
function selected(t,...keys){return keys.map(id=>t.notes.find(n=>n.id===id));}

scenario('Move applies one common beat delta and preserves unselected notes',()=>{
 const t=freeze(track());const out=unchanged(()=>editNotes(t,120,['a','c'],{kind:'move',beats:1.5}),t);
 eq(out.notes.map(n=>n.start),[3.5,2,5.5]);eq(out.selected,['a','c']);eq(out.notes[1],t.notes[1]);ok(out.notes[1]===t.notes[1]);
 for(const i of [0,2])eq({...out.notes[i],start:t.notes[i].start},t.notes[i]);
});
scenario('Transpose preserves chord intervals, rhythm, lengths and velocities',()=>{
 const t=freeze(track());const out=unchanged(()=>editNotes(t,120,ids(t),{kind:'transpose',semitones:-12}),t);
 eq(out.notes.map(n=>n.pitch),[48,52,55]);for(let i=0;i<t.notes.length;i++)eq({...out.notes[i],pitch:t.notes[i].pitch},t.notes[i]);eq(out.selected,ids(t));
});
scenario('Duplicate preserves originals and selects fresh copies in source order',()=>{
 const t=freeze(track()),out=unchanged(()=>editNotes(t,120,['c','a'],{kind:'duplicate',beats:4}),t);
 eq(out.notes.slice(0,3),t.notes);eq(out.notes.length,5);eq(out.notes.slice(3).map(n=>[n.pitch,n.start,n.length,n.velocity]),[[60,6,0.5,0.75],[67,8,1,0.75]]);
 eq(out.selected,out.notes.slice(3).map(n=>n.id));eq(new Set(out.notes.map(n=>n.id)).size,5);for(const id of out.selected)ok(!ids(t).includes(id));
 const later=editNotes({...t,notes:out.notes},120,out.selected,{kind:'duplicate',beats:4});eq(later.notes.slice(-2).map(n=>n.start),[10,12]);eq(new Set(later.notes.map(n=>n.id)).size,7);
});
scenario('Quantize changes selected starts only and retains synchronized chords',()=>{
 const t=freeze(track({notes:[note('a',{start:2.16}),note('b',{start:2.16,pitch:64}),note('c',{start:3.37})]}));
 const out=unchanged(()=>editNotes(t,120,['a','b'],{kind:'quantize',grid:0.25}),t);eq(out.notes.map(n=>n.start),[2.25,2.25,3.37]);
 for(let i=0;i<2;i++)eq({...out.notes[i],start:t.notes[i].start},t.notes[i]);
});
scenario('Length and velocity edits are absolute and selection-only',()=>{
 const t=freeze(track());
 for(const [edit,property,value] of [[{kind:'length',beats:2},'length',2],[{kind:'velocity',value:0.01},'velocity',0.01],[{kind:'velocity',value:1},'velocity',1]]){
  const out=unchanged(()=>editNotes(t,120,['a','c'],edit),t);for(const i of [0,2]){eq(out.notes[i][property],value);eq({...out.notes[i],[property]:t.notes[i][property]},t.notes[i]);}eq(out.notes[1],t.notes[1]);
 }
});
scenario('Delete removes only selected notes and clears selection',()=>{
 const t=freeze(track());const out=unchanged(()=>editNotes(t,120,['c','a'],{kind:'delete'}),t);eq(out.notes,[t.notes[1]]);eq(out.selected,[]);
 const all=editNotes(t,120,ids(t),{kind:'delete'});eq(all.notes,[]);eq(all.selected,[]);
});
scenario('No-op operations return the original note array without sharing selection state',()=>{
 const t=freeze(track()),chosen=['a'];
 for(const edit of [{kind:'move',beats:0},{kind:'transpose',semitones:0},{kind:'quantize',grid:0.25},{kind:'length',beats:0.5},{kind:'velocity',value:0.75}]){
  const out=editNotes(t,120,chosen,edit);ok(out.notes===t.notes);eq(out.selected,chosen);ok(out.selected!==chosen);
 }
});
scenario('Empty, duplicate and stale selection IDs reject without mutation',()=>{
 const t=freeze(track());for(const selection of [[],['a','a'],['missing'],['a','missing']]){
  unchanged(()=>reject(()=>editNotes(t,120,selection,{kind:'delete'})),t);reject(()=>repeatSpan(t,selection,0.25));
 }
});
scenario('Editing rejects missing, empty and duplicate source identities',()=>{
 for(const notes of [[note('a'),note('a')],[note('')],[note(undefined)],[note(1)]]){
  const t=track({notes});reject(()=>checkNotes(t,120,notes),/identity/);
  reject(()=>editNotes(t,120,[notes[0].id],{kind:'move',beats:0}));
 }
});
scenario('Audio, drum and demonstration source types cannot be edited as instrument notes',()=>{
 for(const patch of [{notes:undefined},{fileId:'file-id'},{sequence:[[0]]},{demo:'demo-1'}]){
  const t=track(patch);reject(()=>checkNotes(t,120,[note('new')]));reject(()=>editNotes(t,120,['a'],{kind:'transpose',semitones:1}));
 }
});
scenario('Invalid numeric operation arguments are rejected',()=>{
 const t=freeze(track());
 for(const semitones of [-128,128,0.5,NaN,Infinity])reject(()=>editNotes(t,120,['a'],{kind:'transpose',semitones}));
 for(const beats of [-257,257,NaN,Infinity])reject(()=>editNotes(t,120,['a'],{kind:'move',beats}));
 for(const beats of [-1,0,257,NaN,Infinity])reject(()=>editNotes(t,120,['a'],{kind:'duplicate',beats}));
 for(const grid of [0,0.125,2,NaN,Infinity]){reject(()=>editNotes(t,120,['a'],{kind:'quantize',grid}));reject(()=>repeatSpan(t,['a'],grid));}
 for(const beats of [0,0.009,32.01,NaN,Infinity])reject(()=>editNotes(t,120,['a'],{kind:'length',beats}));
 for(const value of [-1,0,0.009,1.01,NaN,Infinity])reject(()=>editNotes(t,120,['a'],{kind:'velocity',value}));
 reject(()=>editNotes(t,120,['a'],{kind:'unknown'}));
});
scenario('Validation rejects invalid tempo and candidate note values',()=>{
 const t=track();for(const bpm of [39,241,NaN,Infinity])reject(()=>checkNotes(t,bpm,t.notes));
 for(const patch of [{pitch:-1},{pitch:128},{pitch:60.1},{start:-0.1},{start:257},{length:0},{length:33},{velocity:-1},{velocity:1.1},{velocity:NaN}])
  reject(()=>checkNotes(t,120,[note('a',patch)]));
 for(const patch of [{offset:-1},{offset:301},{trimStart:-1},{trimEnd:NaN}])reject(()=>checkNotes(track(patch),120,t.notes));
});
scenario('Transpose rejects the entire chord at either pitch boundary',()=>{
 for(const [pitches,delta] of [[[0,12],-1],[[115,127],1]]){
  const t=freeze(track({notes:pitches.map((pitch,i)=>note('n'+i,{pitch}))}));unchanged(()=>reject(()=>editNotes(t,120,ids(t),{kind:'transpose',semitones:delta}),/entire selection/),t);
 }
 const t=track({notes:[note('a',{pitch:0}),note('b',{pitch:115})]});eq(editNotes(t,120,ids(t),{kind:'transpose',semitones:12}).notes.map(n=>n.pitch),[12,127]);
});
scenario('Move and duplicate reject the entire group when one start crosses a boundary',()=>{
 const left=freeze(track({notes:[note('a',{start:0}),note('b',{start:2})]}));unchanged(()=>reject(()=>editNotes(left,240,ids(left),{kind:'move',beats:-0.25}),/entire selection/),left);
 const right=freeze(track({notes:[note('a',{start:254}),note('b',{start:255.75})]}));
 for(const kind of ['move','duplicate'])unchanged(()=>reject(()=>editNotes(right,240,ids(right),{kind,beats:0.5}),/entire selection/),right);
 eq(editNotes(right,240,ids(right),{kind:'move',beats:0.25}).notes.map(n=>n.start),[254.25,256]);
});
scenario('Duplication allows exactly256 notes and rejects257 atomically',()=>{
 const t=freeze(track({notes:Array.from({length:250},(_,i)=>note('n'+i,{start:i/8}))}));
 const out=editNotes(t,240,ids(t).slice(0,6),{kind:'duplicate',beats:32});eq(out.notes.length,256);eq(new Set(out.notes.map(n=>n.id)).size,256);
 unchanged(()=>reject(()=>editNotes(t,240,ids(t).slice(0,7),{kind:'duplicate',beats:32}),/256 notes/),t);
 reject(()=>checkNotes(track(),120,Array.from({length:257},(_,i)=>note('n'+i))),/256 notes/);
});
scenario('Final timeline checks account for track offset and synthesis tail',()=>{
 const t=freeze(track({offset:295,notes:[note('a',{start:0,length:1})]}));
 const accepted=editNotes(t,120,['a'],{kind:'move',beats:8});eq(accepted.notes[0].start,8);
 unchanged(()=>reject(()=>editNotes(t,120,['a'],{kind:'move',beats:8.001}),/five-minute/),t);
 const high=freeze(track({notes:[note('a',{start:199.5,length:0.01})]}));
 unchanged(()=>reject(()=>editNotes(high,40,['a'],{kind:'length',beats:0.5}),/five-minute/),high);
 eq(editNotes(high,40,['a'],{kind:'length',beats:0.01}).notes,high.notes);
});
scenario('Even empty notes retain the generator minimum duration',()=>{
 eq(checkNotes(track({offset:295.5}),120,[]),[]);reject(()=>checkNotes(track({offset:295.501}),120,[]),/five-minute/);
});
scenario('Stale cached durations do not override note-derived geometry',()=>{
 const t=track({duration:999,notes:[note('a')]});eq(checkNotes(t,120,t.notes),t.notes);
 const invalid=track({duration:1,notes:[note('a',{start:200,length:1})]});reject(()=>checkNotes(invalid,40,invalid.notes),/five-minute/);
});
scenario('Oversized original sources can be repaired by move, shortening, quantize or deletion',()=>{
 const moving=track({notes:[note('a',{start:200,length:1})]});reject(()=>checkNotes(moving,40,moving.notes));eq(editNotes(moving,40,['a'],{kind:'move',beats:-2}).notes[0].start,198);
 const shortening=track({notes:[note('a',{start:190,length:32})]});eq(editNotes(shortening,40,['a'],{kind:'length',beats:8}).notes[0].length,8);
 const quantizing=track({notes:[note('a',{start:199.4,length:0.5})]});reject(()=>checkNotes(quantizing,40,quantizing.notes));eq(editNotes(quantizing,40,['a'],{kind:'quantize',grid:1}).notes[0].start,199);
 const deleting=track({notes:[note('a'),note('long',{start:200,length:32})]});eq(editNotes(deleting,40,['long'],{kind:'delete'}).notes,[deleting.notes[0]]);
 reject(()=>editNotes(deleting,40,['a'],{kind:'velocity',value:0.5}),/five-minute/);
});
scenario('Trimmed and split tracks reject timing/count changes but allow pitch and velocity',()=>{
 for(const geometry of [{trimStart:0.25},{trimEnd:0.25},{splitFrom:'parent-track'}]){
  const t=freeze(track({...geometry,notes:[note('a',{start:2.16})]}));
  for(const edit of [{kind:'move',beats:0.25},{kind:'duplicate',beats:4},{kind:'quantize',grid:0.25},{kind:'length',beats:1},{kind:'delete'}])
   unchanged(()=>reject(()=>editNotes(t,120,['a'],edit),/untrimmed, unsplit/),t);
  eq(editNotes(t,120,['a'],{kind:'transpose',semitones:1}).notes[0].pitch,61);
  eq(editNotes(t,120,['a'],{kind:'velocity',value:0.01}).notes[0].velocity,0.01);
  ok(editNotes(t,120,['a'],{kind:'move',beats:0}).notes===t.notes);
 }
});
scenario('Trimmed candidates cannot silently reorder IDs or become fully trimmed',()=>{
 const t=track({trimStart:0.5});reject(()=>checkNotes(t,120,[t.notes[1],t.notes[0],t.notes[2]]),/untrimmed, unsplit/);
 const silent=track({trimStart:4.5});reject(()=>checkNotes(silent,120,silent.notes),/silent/);
});
scenario('Repeat span uses selected extent including note tails and rounds up to grid',()=>{
 const t=track({notes:[note('a',{start:2.125,length:0.3}),note('unselected',{start:100,length:32}),note('b',{start:3.5,length:0.6})]});
 for(const grid of [0.25,0.5,1])near(repeatSpan(t,['b','a'],grid),2);
 const tiny=track({notes:[note('a',{start:7,length:0.01})]});near(repeatSpan(tiny,['a'],0.25),0.25);
 const exact=track({notes:[note('a',{start:1,length:0.5}),note('b',{start:2,length:1})]});near(repeatSpan(exact,['a','b'],0.5),2);
});
scenario('Existing low MIDI velocities remain intact unless explicitly edited',()=>{
 const t=track({notes:[note('a',{velocity:1/127}),note('b',{velocity:1})]});
 eq(editNotes(t,120,['a'],{kind:'transpose',semitones:12}).notes[0].velocity,1/127);
 eq(editNotes(t,120,['b'],{kind:'velocity',value:0.01}).notes[0].velocity,1/127);
});
scenario('Multiple chord sizes preserve intervals under moves and transpositions',()=>{
 for(let size=1;size<=8;size++){
  const t=freeze(track({notes:Array.from({length:size},(_,i)=>note('n'+i,{pitch:36+i*3,start:2+i/4,length:0.25+i/8,velocity:(i+1)/9}))}));
  for(const [edit,deltaStart,deltaPitch] of [[{kind:'move',beats:3.5},3.5,0],[{kind:'transpose',semitones:24},0,24]]){
   const out=editNotes(t,120,ids(t),edit);
   for(let i=0;i<size;i++){near(out.notes[i].start-t.notes[i].start,deltaStart);eq(out.notes[i].pitch-t.notes[i].pitch,deltaPitch);eq(out.notes[i].length,t.notes[i].length);eq(out.notes[i].velocity,t.notes[i].velocity);eq(out.notes[i].id,t.notes[i].id);}
  }
 }
});
scenario('Apply validates live target and preserves concurrent unrelated edits',()=>{
 const original=track(),other=track({id:'other',name:'Bass'}),data={bpm:120,tracks:[structuredClone(original),other]};
 data.tracks[0].volume=0.2;data.tracks[0].pan=-0.5;data.tracks[1].name='Renamed bass';const before=structuredClone(data);
 const edited=editNotes(original,120,['a','b'],{kind:'transpose',semitones:1});
 const next=applyNotePatch(data,120,original,{notes:edited.notes});eq(next.tracks[0].notes,edited.notes);eq(next.tracks[0].volume,0.2);eq(next.tracks[0].pan,-0.5);eq(next.tracks[1],other);
 eq(next.tracks[0].peaks,undefined);eq(next.tracks[0].duration,undefined);eq(data,before);
});
scenario('Apply rejects stale musical identity, missing target and changed project tempo',()=>{
 const original=track(),notes=editNotes(original,120,['a'],{kind:'move',beats:1}).notes;
 reject(()=>applyNotePatch({bpm:120,tracks:[]},120,original,{notes}),/changed/);reject(()=>applyNotePatch({bpm:121,tracks:[original]},120,original,{notes}),/changed/);
 for(const patch of [{notes:[...original.notes,note('new')]},{sound:'bass'},{offset:1},{trimStart:0.1},{trimEnd:0.1},{splitFrom:'parent'},{fileId:'file'},{demo:'demo-1'},{sequence:[[0]]}])
  reject(()=>applyNotePatch({bpm:120,tracks:[{...original,...patch}]},120,original,{notes}),/changed/);
});
scenario('Apply enforces note and whole-project limits before mutation',()=>{
 const original=track(),data={bpm:120,tracks:[original]};reject(()=>applyNotePatch(data,120,original,{notes:[note('duplicate'),note('duplicate')]}),/identity/);
 reject(()=>applyNotePatch(data,120,original,{notes:[note('a',{pitch:128})]}),/Invalid instrument note/);
 const rest=Array.from({length:31},(_,i)=>track({id:'track-'+i,notes:Array.from({length:100},(_,j)=>note('n'+j+crypto.randomUUID()))}));
 const large={bpm:120,tracks:[original,...rest]},before=structuredClone(large);
 reject(()=>applyNotePatch(large,120,original,{notes:editNotes(original,120,['a'],{kind:'duplicate',beats:4}).notes}),/too large/);eq(large,before);
});
scenario('Apply can repair an oversized source and preserves all non-note controls',()=>{
 const original=track({notes:[note('a'),note('long',{start:200,length:32})],groupId:'group-1',sendReverb:0.5});
 const notes=editNotes(original,40,['long'],{kind:'delete'}).notes;
 const next=applyNotePatch({bpm:40,tracks:[original]},40,original,{notes});eq(next.tracks[0].notes,[original.notes[0]]);eq(next.tracks[0].groupId,'group-1');eq(next.tracks[0].sendReverb,0.5);
});
scenario('Growing or shrinking source duration clears only the fade end anchor',()=>{
 const original=track({notes:[note('a',{start:0,length:1}),note('b',{start:8,length:2})],fadeStart:0.1,fadeEnd:5.5,fadeIn:0.3,fadeOut:0.5,automation:[{time:1,value:0.6}]});
 for(const edit of [{kind:'length',beats:4},{kind:'length',beats:1},{kind:'delete'}]){
  const live={...structuredClone(original),fadeStart:0.25,fadeEnd:6,fadeIn:0.8,fadeOut:2},data={bpm:120,tracks:[live]},before=structuredClone(data);
  const changed=editNotes(original,120,['b'],edit),result=applyNotePatch(data,120,original,{notes:changed.notes}).tracks[0];
  eq(result.fadeEnd,undefined);eq(result.fadeStart,0.25);eq(result.fadeIn,0.8);eq(result.fadeOut,2);eq(result.automation,original.automation);eq(data,before);
 }
});
scenario('Pitch, velocity and interior length changes preserve a live fade end anchor',()=>{
 const original=track({notes:[note('a',{start:0,length:1}),note('b',{start:8,length:2})],fadeStart:0.1,fadeEnd:5.5,fadeIn:0.3,fadeOut:0.5});
 for(const [selection,edit] of [[['b'],{kind:'transpose',semitones:1}],[['b'],{kind:'velocity',value:0.2}],[['a'],{kind:'length',beats:2}]]){
  const live={...structuredClone(original),fadeEnd:5.25,fadeOut:1},changed=editNotes(original,120,selection,edit);
  const result=applyNotePatch({bpm:120,tracks:[live]},120,original,{notes:changed.notes}).tracks[0];
  eq(result.fadeEnd,5.25);eq(result.fadeOut,1);eq(result.fadeIn,0.3);eq(result.fadeStart,0.1);
 }
 const result=applyNotePatch({bpm:120,tracks:[original]},120,original,{sound:'pad'}).tracks[0];eq(result.fadeEnd,5.5);eq(result.sound,'pad');
});
scenario('Edits within the eight-beat duration floor retain fades',()=>{
 const original=track({notes:[note('a',{start:0,length:1})],fadeEnd:4.5});
 const changed=editNotes(original,120,['a'],{kind:'length',beats:2});eq(applyNotePatch({bpm:120,tracks:[original]},120,original,{notes:changed.notes}).tracks[0].fadeEnd,4.5);
});
scenario('Trimmed and split pitch/velocity edits preserve all fade and crop anchors',()=>{
 for(const geometry of [{trimStart:0.5},{trimEnd:0.5},{splitFrom:'parent-track'}]){
  const original=track({...geometry,fadeStart:0.5,fadeEnd:4,fadeIn:0.3,fadeOut:0.75,automation:[{time:1,value:0.5}]});
  for(const edit of [{kind:'transpose',semitones:1},{kind:'velocity',value:0.5}]){
   const changed=editNotes(original,120,['a'],edit),out=applyNotePatch({bpm:120,tracks:[original]},120,original,{notes:changed.notes}).tracks[0];
   for(const key of ['fadeStart','fadeEnd','fadeIn','fadeOut','trimStart','trimEnd','splitFrom','automation'])eq(out[key],original[key]);
  }
 }
});

console.log(`\nNote editing: ${checks} assertions, ${passed} scenarios passed, ${failures.length} failed.`);
if(failures.length){for(const failure of failures)console.error(failure);process.exitCode=1;}
