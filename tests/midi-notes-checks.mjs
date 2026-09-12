import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run from the SESSION checkout; imports the real TypeScript through its test loader.
const { loadTS } = await import(pathToFileURL(path.resolve('tests/load-ts.mjs')));
const { midiEvent, midiPlan, MidiPerformance, quantizeMidi, keepMidi } = loadTS('lib/midi-notes.ts');
const { validateArrangement } = loadTS('lib/arrangement-validation.ts');
let checks = 0, passed = 0;
const failures = [];
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const ok = (a, message) => { assert.ok(a, message); checks++; };
const close = (a, b, message) => { assert.ok(Math.abs(a-b) < 1e-9, message || `${a} should equal ${b}`); checks++; };
const rejects = (fn, message) => { assert.throws(fn, message); checks++; };
const scenario = (name, fn) => {
  try { fn(); passed++; console.log('PASS '+name); }
  catch (error) { failures.push(name+': '+error.message); console.log('FAIL '+name+': '+error.message); }
};
const track = (patch = {}) => ({
  id:'keys-track', name:'Soft keys', notes:[], sound:'keys', offset:0,
  trimStart:0, trimEnd:0, volume:0.8, pan:0, muted:false, solo:false,
  low:0, mid:0, high:0, duration:5, peaks:[0.2,0.3], ...patch,
});
const note = (patch = {}) => ({id:crypto.randomUUID(), pitch:60, start:0, length:1, velocity:0.75, ...patch});
const plan = (patch={}) => ({start:0, beats:4, timeline:0, bpm:120, capacity:256, ...patch});
function recorder(patch={}) {
  const p=plan(patch), start=1000, performance=new MidiPerformance(p,start);
  const stamp=beat=>start+beat*60000/p.bpm;
  const event=(packet,beat)=>{ const value=midiEvent(packet); if(value) performance.push(value,stamp(beat)); };
  return {p, performance, stamp, event, finish:beat=>performance.finish(stamp(beat))};
}
const shape = notes => notes.map(({id,...n})=>n);
function validNotes(notes) {
  validateArrangement({bpm:120,tracks:[track({notes})]},true);
  checks++;
  eq(new Set(notes.map(n=>n.id)).size,notes.length,'Recorded note identities must be unique');
}

scenario('Parser distinguishes messages, channels, velocity zero and pedal threshold',()=>{
  eq(midiEvent(Uint8Array.from([0x9f,127,127])),{kind:'on',channel:15,pitch:127,velocity:1});
  eq(midiEvent([0x90,0,1]),{kind:'on',channel:0,pitch:0,velocity:1/127});
  eq(midiEvent([0x92,61,0]),{kind:'off',channel:2,pitch:61});
  eq(midiEvent([0x82,61,127]),{kind:'off',channel:2,pitch:61});
  eq(midiEvent([0xb3,64,63]),{kind:'pedal',channel:3,down:false});
  eq(midiEvent([0xb3,64,64]),{kind:'pedal',channel:3,down:true});
  for(const control of [120,121,123]) eq(midiEvent([0xbf,control,0]),{kind:'reset',channel:15});
});
scenario('Parser ignores unsupported or malformed packets',()=>{
  for(const packet of [[],[0x90],[0x90,60],[0x90,60,1,0],[0x90,128,1],[0x90,60,128],
    [0x90,-1,1],[0x90,60,0.5],[NaN,60,1],[Infinity,60,1],[-1,60,1],[256,60,1],
    [60,60,1],[0xe0,0,64],[0xa0,60,64],[0xb0,7,100],[0xf0,0,0],[0xf8,0,0]]) eq(midiEvent(packet),null);
});
scenario('Performance records a chord and velocity-zero releases',()=>{
  const r=recorder({start:3});
  r.event([0x90,67,127],0); r.event([0x90,60,32],0); r.event([0x90,64,64],0);
  eq(r.performance.count,3);
  r.event([0x90,60,0],0.5); r.event([0x80,64,0],1); r.event([0x80,67,0],1.5);
  const notes=r.finish(2);
  eq(shape(notes),[
    {pitch:60,start:3,length:0.5,velocity:32/127},
    {pitch:64,start:3,length:1,velocity:64/127},
    {pitch:67,start:3,length:1.5,velocity:1},
  ]);
  validNotes(notes);
});
scenario('Identical pitches on separate channels have independent note-offs',()=>{
  const r=recorder(); r.event([0x90,60,100],0); r.event([0x91,60,80],0.25);
  r.event([0x80,60,0],0.5); r.event([0x81,60,0],1.25);
  const notes=r.finish(2); eq(notes.length,2); close(notes[0].length,0.5); close(notes[1].length,1); validNotes(notes);
});
scenario('Sustain extends released keys only on its own channel',()=>{
  const r=recorder(); r.event([0xb0,64,127],0);
  r.event([0x90,60,100],0); r.event([0x91,62,90],0); r.event([0x90,67,80],0);
  r.event([0x80,60,0],0.5); r.event([0x81,62,0],0.5); r.event([0xb0,64,0],2);
  r.event([0x80,67,0],3);
  const n=r.finish(3); eq(n.map(x=>[x.pitch,x.length]),[[60,2],[62,0.5],[67,3]]); validNotes(n);
});
scenario('Reset closes channel voices and releases its pedal state',()=>{
  for(const control of [120,121,123]) {
    const r=recorder(); r.event([0xb0,64,127],0); r.event([0x90,60,100],0); r.event([0x91,62,100],0);
    r.event([0x80,60,0],0.5); r.event([0xb0,control,0],1);
    r.event([0x90,64,100],1.5); r.event([0x80,64,0],2); r.event([0x81,62,0],2.5);
    const n=r.finish(3); eq(n.map(x=>[x.pitch,x.length]),[[60,1],[62,2.5],[64,0.5]]); validNotes(n);
  }
});
scenario('Repeated note-ons terminate the prior voice without overwriting its original',()=>{
  const r=recorder(); r.event([0x90,60,40],0); r.event([0x90,60,100],1); r.event([0x80,60,0],2);
  const notes=r.finish(3); eq(notes.length,2); eq(notes.map(n=>[n.start,n.length,n.velocity]),[[0,1,40/127],[1,1,100/127]]); validNotes(notes);
});
scenario('Repeated note-ons under sustain create two bounded notes',()=>{
  const r=recorder(); r.event([0xb0,64,127],0); r.event([0x90,60,40],0); r.event([0x80,60,0],0.5);
  r.event([0x90,60,100],1); r.event([0x80,60,0],1.5); r.event([0xb0,64,0],2);
  const notes=r.finish(3); eq(notes.map(n=>[n.start,n.length]),[[0,1],[1,1]]); validNotes(notes);
});
scenario('Unmatched releases and empty recording produce no notes',()=>{
  const r=recorder(); r.event([0x80,60,0],0); r.event([0xb0,64,0],0); r.event([0xb0,123,0],1);
  eq(r.finish(2),[]); eq(r.performance.count,0);
});
scenario('Pre-start, nonfinite, stale and out-of-range timestamps are ignored',()=>{
  const r=recorder(); r.event([0x90,59,127],-1); r.performance.push(midiEvent([0x90,58,100]),NaN);
  r.performance.push(midiEvent([0x90,57,100]),Infinity);
  r.event([0x90,60,100],1); r.event([0x80,60,0],0.5); r.event([0x90,61,100],5);
  r.event([0x80,60,0],2);
  const notes=r.finish(4); eq(notes.map(n=>[n.pitch,n.start,n.length]),[[60,1,1]]); validNotes(notes);
});
scenario('Range cutoff closes held keys and rejects notes too close to the end',()=>{
  const r=recorder(); r.event([0x90,60,100],0); r.event([0x90,61,100],3.995); r.event([0x90,62,100],4);
  const notes=r.finish(20); eq(notes.map(n=>[n.pitch,n.start,n.length]),[[60,0,4]]); validNotes(notes);
});
scenario('Immediate release has a valid minimum duration and finish cannot rewind last event',()=>{
  const r=recorder(); r.event([0x90,60,100],1); r.event([0x80,60,0],1); r.event([0x90,62,100],2);
  const notes=r.finish(0); eq(notes.length,2); close(notes[0].length,0.01); close(notes[1].length,0.01); validNotes(notes);
});
scenario('Maximum-length hold stays within the validator limit',()=>{
  const r=recorder({start:224,beats:32,bpm:40}); r.event([0x90,0,1],0); r.event([0x9f,127,127],0);
  const notes=r.finish(50); eq(notes.map(n=>[n.pitch,n.start,n.length]),[[0,224,32],[127,224,32]]); validNotes(notes);
});
scenario('Capacity includes both held and finished notes',()=>{
  const r=recorder({capacity:2}); r.event([0x90,60,100],0); r.event([0x90,64,100],0);
  r.event([0x80,60,0],1); r.event([0x90,67,100],1);
  eq(r.performance.full,true); eq(r.performance.count,2); eq(r.finish(2).map(n=>n.pitch),[60,64]);
});
scenario('Retrigger at capacity keeps the old note and never inserts a replacement',()=>{
  const r=recorder({capacity:1}); r.event([0x90,60,40],0); r.event([0x90,60,100],1); r.event([0x80,60,0],2);
  const notes=r.finish(4); eq(notes.length,1); close(notes[0].length,1); close(notes[0].velocity,40/127); eq(r.performance.full,true);
});
scenario('256-note cap stays bounded under additional channel traffic',()=>{
  const r=recorder();
  for(let channel=0;channel<3;channel++) for(let pitch=0;pitch<128;pitch++) r.event([0x90+channel,pitch,100],0);
  eq(r.performance.count,256); eq(r.performance.full,true); const notes=r.finish(2); eq(notes.length,256); validNotes(notes);
});
scenario('Finishing twice returns stable independent snapshots',()=>{
  const r=recorder(); r.event([0x90,60,100],0);
  const first=r.finish(1), second=r.finish(3); eq(first,second); ok(first!==second); ok(first[0]!==second[0]);
  first[0].pitch=1; eq(r.finish(3)[0].pitch,60);
});
scenario('Nonfinite finish timestamps cannot yield invalid recorded notes',()=>{
  for(const stamp of [NaN,Infinity,-Infinity]) {
    const r=recorder(); r.event([0x90,60,100],0);
    let notes;
    try { notes=r.performance.finish(stamp); }
    catch { checks++; continue; }
    validNotes(notes);
  }
});
scenario('Quantization preserves originals, durations, velocity and identifiers',()=>{
  const notes=[note({start:2.18,length:0.4}),note({start:3.82,length:0.4,pitch:64})], before=structuredClone(notes);
  const quantized=quantizeMidi(notes,0.25,plan({start:2,beats:2}));
  close(quantized[0].start,2.25); close(quantized[1].start,3.6); eq(notes,before);
  for(let i=0;i<notes.length;i++) {eq({...quantized[i],start:notes[i].start},notes[i]);ok(quantized[i]!==notes[i]);}
  eq(quantizeMidi(notes,0,plan({start:2,beats:2})),notes);
  for(const grid of [0.125,2,-1,NaN,Infinity]) rejects(()=>quantizeMidi(notes,grid,plan()),/grid/);
});
scenario('Quantization never moves notes before or beyond the capture range',()=>{
  const p=plan({start:0.13,beats:1.2}), notes=[note({start:0.14,length:0.2}),note({start:1.01,length:0.32})];
  for(const grid of [0.25,0.5,1]) {
    const quantized=quantizeMidi(notes,grid,p);
    for(const n of quantized) {ok(n.start>=p.start);ok(n.start+n.length<=p.start+p.beats+1e-9);}
  }
});
scenario('Plan maps source beats to project seconds and remaining capacity',()=>{
  const t=track({offset:20,notes:[note()]}); eq(midiPlan(t,120,4,8),{start:4,beats:8,bpm:120,capacity:255,timeline:22});
  // The generated source retains its half-second release tail at the boundary.
  const p=midiPlan(track({offset:235.5}),240,224,32); close(p.timeline,291.5); eq(p.beats,32);
  rejects(()=>midiPlan(track({offset:236}),240,224,32));
});
scenario('Plan rejects noninstrument, trimmed, split, full and impossible ranges',()=>{
  for(const patch of [{notes:undefined},{fileId:'audio'},{sequence:[[0]]},{demo:'demo-1'},
    {trimStart:0.1},{trimEnd:0.1},{splitFrom:'original'},{notes:Array.from({length:256},()=>note())}]) rejects(()=>midiPlan(track(patch),120,0,4));
  for(const [bpm,start,beats,offset] of [[39,0,4,0],[241,0,4,0],[NaN,0,4,0],[120,-1,4,0],
    [120,256,0.25,0],[120,255,2,0],[120,0,0.24,0],[120,0,33,0],[120,0,4,-1],[120,0,4,299],
    [120,Infinity,4,0],[120,0,NaN,0],[120,0,4,Infinity]]) rejects(()=>midiPlan(track({offset}),bpm,start,beats));
});
scenario('Recorder rejects malformed plans and start clocks',()=>{
  for(const patch of [{capacity:0},{capacity:257},{capacity:1.5},{start:-1},{start:255,beats:2},
    {beats:0.1},{beats:33},{bpm:0},{bpm:NaN}]) rejects(()=>new MidiPerformance(plan(patch),0));
  rejects(()=>new MidiPerformance(plan(),NaN)); rejects(()=>new MidiPerformance(plan(),Infinity));
});
scenario('Keep appends once, preserves other tracks and does not mutate input snapshots',()=>{
  const target=track({notes:[note({id:'existing'})]}), other=track({id:'other-track',name:'Bass'});
  const original={bpm:120,tracks:[target,other]}, before=structuredClone(original), recorded=[note({id:'new-note',start:2})];
  const current=structuredClone(original); current.tracks[0].volume=0.5; current.tracks[1].pan=0.4;
  const next=keepMidi(current,original,target,recorded);
  eq(next.tracks[0].notes,[...target.notes,...recorded]); eq(next.tracks[0].volume,0.5); eq(next.tracks[1],current.tracks[1]);
  eq(next.tracks[0].peaks,undefined); eq(next.tracks[0].duration,undefined); eq(original,before); eq(current.tracks[0].notes.length,1);
  rejects(()=>keepMidi(next,original,target,recorded),/changed/);
});
scenario('Keep refuses missing or changed target and changed tempo',()=>{
  const target=track({notes:[note()]}), original={bpm:120,tracks:[target]}, recorded=[note({start:2})];
  rejects(()=>keepMidi({bpm:120,tracks:[]},original,target,recorded),/changed/);
  rejects(()=>keepMidi({...original,bpm:121},original,target,recorded),/changed/);
  for(const patch of [{notes:[]},{sound:'bass'},{offset:1},{trimStart:0.1},{trimEnd:0.1},{splitFrom:'prior'},
    {fileId:'file'},{sequence:[[0]]},{demo:'demo-1'}]) rejects(()=>keepMidi({bpm:120,tracks:[{...target,...patch}]},original,target,recorded),/changed/);
});
scenario('Keep rejects empty take, invalid musical data and note count overflow',()=>{
  const target=track(), original={bpm:120,tracks:[target]};
  rejects(()=>keepMidi(original,original,target,[]),/at least one/);
  for(const patch of [{pitch:128},{pitch:-1},{pitch:60.5},{start:-0.1},{start:257},{length:0},{length:33},{velocity:1.1},{velocity:NaN}])
    rejects(()=>keepMidi(original,original,target,[note(patch)]),/Invalid instrument note/);
  const full=track({notes:Array.from({length:256},()=>note())}), fullData={bpm:120,tracks:[full]};
  rejects(()=>keepMidi(fullData,fullData,full,[note()]),/256/);
});
scenario('Keep enforces total arrangement payload size',()=>{
  const target=track(), others=Array.from({length:31},(_,i)=>track({id:'other-'+i,notes:Array.from({length:128},()=>note())})), original={bpm:120,tracks:[target,...others]};
  validateArrangement(original,true); checks++;
  rejects(()=>keepMidi(original,original,target,[note()]),/too large/);
});

scenario('Sustain during count-in survives without capturing early notes',()=>{
  const p=new MidiPerformance(midiPlan(track(),120,0,4),1000);
  p.push(midiEvent([0xB0,64,127]),900);
  p.push(midiEvent([0x90,60,100]),950);
  p.push(midiEvent([0x80,60,0]),980);
  p.push(midiEvent([0x90,61,100]),1100);
  p.push(midiEvent([0x80,61,0]),1200);
  p.push(midiEvent([0xB0,64,0]),1500);
  const notes=p.finish(1600);eq(notes.length,1);eq(notes[0].pitch,61);close(notes[0].length,.8);
  p.push(midiEvent([0x90,65,100]),1700);eq(p.finish(1800),notes,'Completed performance accepted later input');
});
const {midiFile}=loadTS('lib/audio.ts');
const velocities=Array.from({length:127},(_,i)=>i+1);
const exported=new Uint8Array(await midiFile(velocities.map((v,i)=>note({pitch:i,start:i,length:.25,velocity:midiEvent([0x90,i,v]).velocity})),120).arrayBuffer());
scenario('MIDI downloads preserve every captured note-on velocity',()=>{
  let at=22,tick=0,index=0;
  while(at<exported.length){let delta=0,byte;do{byte=exported[at++];delta=(delta<<7)|(byte&127);}while(byte&128);tick+=delta;const status=exported[at++];
    if(status===255){const kind=exported[at++],length=exported[at++];at+=length;if(kind===47)break;}
    else{const pitch=exported[at++],velocity=exported[at++];if(status===144){eq(pitch,index);eq(velocity,velocities[index]);eq(tick,index*480);index++;}}
  }
  eq(index,127,'Exported note count changed');
});
console.log(`\nMIDI notes: ${checks} assertions, ${passed} scenarios passed, ${failures.length} failed.`);
if(failures.length) { for(const failure of failures) console.error(failure); process.exitCode=1; }
