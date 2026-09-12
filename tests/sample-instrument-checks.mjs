import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {loadTS}=await import(pathToFileURL(path.resolve('tests/load-ts.mjs')));
const {sampleSettings,defaultSample,sampleTiming,checkSampleBuffer,playSample}=loadTS('lib/sample-instrument.ts');
const {validateArrangement}=loadTS('lib/arrangement-validation.ts');
const {recoverySnapshot}=loadTS('lib/draft-recovery.ts');
const {editNotes,checkNotes,applyNotePatch}=loadTS('lib/note-edit.ts');
const {midiPlan,keepMidi}=loadTS('lib/midi-notes.ts');
const {mergeProject,sameProject}=loadTS('lib/project-merge.ts');
const {checkPunchTarget,punchSeed,applyPunchClip}=loadTS('lib/punch-clip.ts');
const {defaults}=loadTS('lib/audio.ts');
let checks=0,passed=0;const failures=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const ok=(v,m)=>{assert.ok(v,m);checks++;};
const near=(a,b)=>{assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);checks++;};
const reject=(fn,rx)=>{assert.throws(fn,rx);checks++;};
const rejectAsync=async(fn,rx)=>{await assert.rejects(fn,rx);checks++;};
async function scenario(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message);}}
const settings=(patch={})=>({rootPitch:60,start:0,end:4,attack:0.005,release:0.08,...patch});
const note=(id,patch={})=>({id,pitch:60,start:2,length:0.5,velocity:0.75,...patch});
const track=(patch={})=>({...defaults('Sampler'),fileId:'sample-a',sample:settings(),notes:[note('a'),note('b',{pitch:64,start:3,length:1})],duration:4.5,peaks:[0.1],...patch});
const arrangement=(t,bpm=120)=>({bpm,tracks:[t]});
const snapshot=t=>({title:'Sample song',data:arrangement(t)});
const buffer=(patch={})=>({numberOfChannels:2,sampleRate:48000,duration:4,length:192000,...patch});
const ids=t=>t.notes.map(n=>n.id);
function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;}
function unchanged(fn,input){const before=structuredClone(input);const out=fn();eq(input,before,'Input must not mutate');return out;}
const sourceKeys=['fileId','sample','notes','sound','demo','sequence'];
const source=t=>Object.fromEntries(sourceKeys.filter(k=>t[k]!==undefined).map(k=>[k,t[k]]));

await scenario('Repeated sound settings preserve arrangement identity and derived audio',()=>{
 const t=track(), data=arrangement(t);
 ok(applyNotePatch(data,120,t,{sample:structuredClone(t.sample),peaks:undefined,duration:undefined})===data);
 const builtin=track({sample:undefined,fileId:undefined,sound:'keys'}), built=arrangement(builtin);
 ok(applyNotePatch(built,120,builtin,{sound:'keys',sample:undefined,fileId:undefined,peaks:undefined,duration:undefined})===built);
});

await scenario('Settings normalize known fields, preserve input and return a fresh value',()=>{
 const input=freeze({...settings(),unused:{secret:'omit'}});const out=unchanged(()=>sampleSettings(input),input);
 eq(out,settings());ok(out!==input);eq(Object.keys(out),['rootPitch','start','end','attack','release']);
});
await scenario('Settings accept exact pitch, zone and envelope boundaries',()=>{
 for(const rootPitch of [0,60,127])for(const patch of [{start:0,end:0.01,attack:0,release:0},{start:29.99,end:30,attack:2,release:0.5}])
  eq(sampleSettings(settings({...patch,rootPitch})),settings({...patch,rootPitch}));
});
await scenario('Settings reject malformed shapes, missing fields and numeric bounds',()=>{
 for(const value of [null,undefined,[],0,'sample',true])reject(()=>sampleSettings(value));
 for(const field of ['rootPitch','start','end','attack','release']){
  const v=settings();delete v[field];reject(()=>sampleSettings(v));
  for(const value of [NaN,Infinity,-Infinity,undefined,null,'1'])reject(()=>sampleSettings(settings({[field]:value})));
 }
 for(const patch of [{rootPitch:-1},{rootPitch:128},{rootPitch:60.5},{start:-0.01},{end:30.001},{start:2,end:1},{start:2,end:2},{start:2,end:2.009},{attack:-0.001},{attack:2.001},{release:-0.001},{release:0.501}])reject(()=>sampleSettings(settings(patch)));
});
await scenario('Optional sample name is retained, validated and recovered without extra fields',()=>{
 const s=sampleSettings(settings({name:'Warm keys'}));eq(s.name,'Warm keys');
 const restored=recoverySnapshot(snapshot(track({sample:s})));eq(restored.data.tracks[0].sample.name,'Warm keys');ok(restored.data.tracks[0].sample!==s);
 for(const name of ['', '   ',null,7,{},'x'.repeat(101)])reject(()=>sampleSettings(settings({name})));
 eq(sampleSettings(settings({name:'x'.repeat(100)})).name.length,100);
});
await scenario('Default settings use C4 and floor the source end to milliseconds without mutation',()=>{
 eq(defaultSample(1.23456),settings({end:1.234}));eq(defaultSample(0.01),settings({end:0.01}));eq(defaultSample(30),settings({end:30}));
 for(const duration of [-1,0,0.0099,30.001,31,NaN,-Infinity])reject(()=>defaultSample(duration));
});
await scenario('Default settings reject nonfinite source duration',()=>reject(()=>defaultSample(Infinity)));
await scenario('Root and octave transpositions produce expected rates and source exhaustion',()=>{
 const s=freeze(settings({start:1,end:3,attack:0,release:0}));
 for(const [pitch,rate,duration] of [[60,1,2],[72,2,1],[48,0.5,4]]){
  const out=unchanged(()=>sampleTiming(s,pitch,10),s);eq(out.rate,rate);eq(out.duration,duration);eq(out.releaseAt,duration);eq(out.attack,0);
 }
});
await scenario('Long notes use source exhaustion while shorter gates include the release tail',()=>{
 const s=settings({end:1,release:0.2,attack:0.05});
 const short=sampleTiming(s,60,0.3);near(short.duration,0.5);near(short.releaseAt,0.3);eq(short.attack,0.05);
 const long=sampleTiming(s,60,10);eq(long.duration,1);near(long.releaseAt,0.8);
 const shifted=sampleTiming({...s,start:0.5,end:1.5},60,10);eq(shifted,long);
});
await scenario('A short note begins its release at note-off rather than sustaining for half its tail',()=>{
 const out=sampleTiming(settings({end:30,attack:0.005,release:0.5}),60,0.01);
 near(out.duration,0.51);near(out.releaseAt,0.01);near(out.attack,0.005);
});
await scenario('Short gates and exhausted sources retain the intended attack slope',()=>{
 const gate=sampleTiming(settings({end:4,attack:2,release:0.5}),60,0.01);near(gate.attack,0.01);near(gate.peakFactor,0.005);near(gate.releaseAt,0.01);
 const natural=sampleTiming(settings({end:0.1,attack:2,release:0.5}),60,10);near(natural.attack,0.05);near(natural.peakFactor,0.025);near(natural.releaseAt,0.05);near(natural.duration,0.1);
 const full=sampleTiming(settings({end:4,attack:0.005,release:0.1}),60,1);eq(full.peakFactor,1);
 const immediate=sampleTiming(settings({attack:0}),60,0.01);eq(immediate.peakFactor,1);
});
await scenario('Attack fits before release and all pitch extremes remain finite',()=>{
 for(const rootPitch of [0,60,127])for(const pitch of [0,60,127])for(const length of [0.005,0.1,2,300]){
  const s=settings({rootPitch,start:0,end:0.01,attack:2,release:0.5});const timing=sampleTiming(s,pitch,length);
  for(const key of ['rate','duration','releaseAt','attack'])ok(Number.isFinite(timing[key]));
  ok(timing.duration>0);ok(timing.attack>=0);ok(timing.attack<=timing.releaseAt);ok(timing.releaseAt<=timing.duration);
  ok(timing.duration<=length+0.5);near(timing.rate,2**((pitch-rootPitch)/12));
 }
});
await scenario('Timing rejects invalid pitches, durations and settings',()=>{
 for(const pitch of [-1,128,60.1,NaN,Infinity,'60',null])reject(()=>sampleTiming(settings(),pitch,1));
 for(const length of [-1,0,300.01,NaN,Infinity,'1',null])reject(()=>sampleTiming(settings(),60,length));
 reject(()=>sampleTiming(settings({end:0}),60,1));
});
await scenario('Source buffer checks mono/stereo, duration, zone and memory bounds',()=>{
 for(const numberOfChannels of [1,2])checkSampleBuffer(buffer({numberOfChannels}),settings());
 checks+=2;
 for(const numberOfChannels of [0,3,8])reject(()=>checkSampleBuffer(buffer({numberOfChannels})));
 for(const duration of [0,0.0099,NaN,Infinity,30.001])reject(()=>checkSampleBuffer(buffer({duration})));
 checkSampleBuffer(buffer({duration:30,length:1440000}),settings({end:30}));checks++;
 checkSampleBuffer(buffer({duration:1,length:48000}),settings({end:1+1/48000}));checks++;
 reject(()=>checkSampleBuffer(buffer({duration:1,length:48000}),settings({end:1+2/48000})));
 const exact=buffer({sampleRate:192000,length:4194304,duration:4194304/192000});checkSampleBuffer(exact);checks++;
 reject(()=>checkSampleBuffer({...exact,length:4194305,duration:4194305/192000}));
});
await scenario('Arrangement accepts coupled sampler and existing synth/audio modes',()=>{
 for(const t of [track(),track({notes:[]}),track({fileId:undefined,sample:undefined}),track({notes:undefined,sample:undefined})])
  for(const draft of [false,true]){unchanged(()=>validateArrangement(arrangement(freeze(t)),draft),t);checks++;}
});
await scenario('Arrangement rejects incomplete and conflicting sampler modes',()=>{
 for(const patch of [{fileId:undefined},{fileId:''},{fileId:9},{fileId:'x'.repeat(129)},{notes:undefined},{notes:null},{notes:{}},{demo:'demo-1'},{sequence:Array.from({length:3},()=>Array(16).fill(0))},{sample:null},{sample:false},{sample:[]}])
  for(const draft of [false,true])reject(()=>validateArrangement(arrangement(track(patch)),draft));
 reject(()=>validateArrangement(arrangement(track({sample:undefined}))));
 for(const patch of [{rootPitch:-1},{start:4,end:3},{release:0.51},{attack:NaN}])reject(()=>validateArrangement(arrangement(track({sample:settings(patch)}))));
});
await scenario('Sampler notes retain common note, tempo and capacity validation',()=>{
 for(const patch of [{pitch:128},{pitch:0.5},{start:257},{length:0},{length:32.01},{velocity:1.01}])reject(()=>validateArrangement(arrangement(track({notes:[note('n',patch)]}))));
 reject(()=>validateArrangement(arrangement(track({notes:Array.from({length:257},(_,i)=>note('n'+i))}))));
 for(const bpm of [39,241,NaN])reject(()=>validateArrangement(arrangement(track(),bpm)));
});
await scenario('Recovery retains sampler source and notes, strips unknown fields and deeply clones',()=>{
 const t=freeze(track({sample:{...settings(),junk:{x:1}},stray:'omit'}));const input=freeze(snapshot(t));
 const out=unchanged(()=>recoverySnapshot(input),input);const restored=out.data.tracks[0];
 eq(restored.sample,settings());eq(restored.fileId,'sample-a');eq(restored.notes,t.notes);eq(restored.stray,undefined);eq(restored.duration,undefined);eq(restored.peaks,undefined);
 ok(restored!==t);ok(restored.sample!==t.sample);ok(restored.notes!==t.notes);ok(restored.notes[0]!==t.notes[0]);
 restored.sample.start=1;restored.notes[0].pitch=50;eq(t.sample.start,0);eq(t.notes[0].pitch,60);
});
await scenario('Recovery rejects malformed or decoupled samples',()=>{
 for(const patch of [{sample:settings({end:0})},{sample:undefined},{fileId:undefined},{notes:undefined},{sample:null}])reject(()=>recoverySnapshot(snapshot(track(patch))));
});
await scenario('Sample notes allow edits and preserve their source settings',()=>{
 const t=freeze(track());
 for(const edit of [{kind:'drag',beats:1,semitones:12},{kind:'resize',beats:0.25},{kind:'duplicate',beats:4},{kind:'velocity',value:0.5},{kind:'delete'}]){
  const out=unchanged(()=>editNotes(t,120,['a'],edit),t);checkNotes(t,120,out.notes);checks++;
  const committed=applyNotePatch(arrangement(t),120,t,{notes:out.notes}).tracks[0];eq(committed.fileId,t.fileId);eq(committed.sample,t.sample);
 }
 ok(editNotes(t,120,['a'],{kind:'drag',beats:0,semitones:0}).notes===t.notes);
});
await scenario('Sampler trims/splits retain pitch-only policy and source/timeline limits',()=>{
 for(const patch of [{trimStart:0.1},{trimEnd:0.1},{splitFrom:'parent'}]){
  const t=track(patch);editNotes(t,120,['a'],{kind:'transpose',semitones:1});checks++;
  reject(()=>editNotes(t,120,['a'],{kind:'resize',beats:0.25}),/untrimmed/);
 }
 reject(()=>editNotes(track({offset:296}),120,['a'],{kind:'transpose',semitones:1}),/five-minute/);
 reject(()=>editNotes(track({notes:[note('a',{start:200,length:1})]}),40,['a'],{kind:'transpose',semitones:1}),/five-minute/);
});
await scenario('Sample changes invalidate note patch snapshots without losing live mixer changes',()=>{
 const t=freeze(track());const notes=editNotes(t,120,['a'],{kind:'transpose',semitones:1}).notes;
 for(const patch of [{rootPitch:61},{start:0.5},{end:3},{attack:0.1},{release:0.2}])reject(()=>applyNotePatch(arrangement({...t,sample:settings(patch)}),120,t,{notes}),/changed/);
 reject(()=>applyNotePatch(arrangement({...t,fileId:'replacement'}),120,t,{notes}),/changed/);
 const next=applyNotePatch(arrangement({...t,pan:0.25,volume:0.5}),120,t,{notes}).tracks[0];eq(next.pan,0.25);eq(next.volume,0.5);
});
await scenario('Sample MIDI planning supports empty or occupied instruments and rejects trims/full tracks',()=>{
 const t=freeze(track());eq(unchanged(()=>midiPlan(t,120,4,8),t),{start:4,beats:8,bpm:120,capacity:254,timeline:2});
 eq(midiPlan(track({notes:[]}),120,0,4).capacity,256);
 for(const patch of [{trimStart:0.1},{trimEnd:0.1},{splitFrom:'parent'},{sample:undefined},{notes:undefined},{notes:Array.from({length:256},(_,i)=>note('n'+i))}])reject(()=>midiPlan(track(patch),120,0,4));
 for(const [bpm,start,beats] of [[39,0,4],[120,-1,4],[120,256,1],[120,255,2],[120,0,33],[120,0,0.1],[120,NaN,4]])reject(()=>midiPlan(t,bpm,start,beats));
});
await scenario('Keep MIDI appends to sampler with immutable input and current faders',()=>{
 const t=freeze(track());const original=freeze(arrangement(t));const live=freeze(arrangement({...t,pan:0.25,volume:0.4}));const added=freeze([note('take',{start:5,pitch:72})]);
 const next=unchanged(()=>keepMidi(live,original,t,added),live);eq(next.tracks[0].notes,[...t.notes,...added]);eq(next.tracks[0].sample,t.sample);eq(next.tracks[0].fileId,t.fileId);eq(next.tracks[0].pan,0.25);eq(next.tracks[0].volume,0.4);eq(next.tracks[0].peaks,undefined);eq(next.tracks[0].duration,undefined);
});
await scenario('Keep MIDI refuses changed sample source, settings and tempo',()=>{
 const t=track(),original=arrangement(t),added=[note('take')];
 for(const patch of [{rootPitch:61},{start:0.5},{end:3},{attack:0.1},{release:0.2}])reject(()=>keepMidi(arrangement({...t,sample:settings(patch)}),original,t,added),/changed/);
 for(const patch of [{fileId:'new'},{notes:[...t.notes,note('other')]},{sample:undefined}])reject(()=>keepMidi(arrangement({...t,...patch}),original,t,added),/changed/);
 reject(()=>keepMidi(arrangement(t,121),original,t,added),/changed/);reject(()=>keepMidi({bpm:120,tracks:[]},original,t,added),/changed/);
});
await scenario('Keep MIDI enforces notes, count and final JSON bounds',()=>{
 const t=track(),data=arrangement(t);reject(()=>keepMidi(data,data,t,[]));
 reject(()=>keepMidi(data,data,t,[note('take',{pitch:128})]));
 reject(()=>keepMidi(data,data,t,Array.from({length:255},(_,i)=>note('n'+i))));
 reject(()=>keepMidi(data,data,t,[note('x'.repeat(250000))]),/too large/);
});
await scenario('Keep MIDI rejects sampled note sources beyond the renderable five-minute bound',()=>{
 const t=track({notes:[]});const data=arrangement(t,40);
 reject(()=>keepMidi(data,data,t,[note('take',{start:199.5,length:0.25})]),/five-minute/);
});
await scenario('Sampler MIDI plans leave room for the generated half-second source tail',()=>{
 const t=track({notes:[]});reject(()=>midiPlan(t,40,199.5,0.25),/five-minute/);
});
await scenario('MIDI plans account for offset, minimum eight-beat source and later existing notes',()=>{
 const exact=track({notes:[],offset:295.5});eq(midiPlan(exact,120,0,0.25).timeline,295.5);
 reject(()=>midiPlan({...exact,offset:295.501},120,0,0.25),/five-minute/);
 const later=track({notes:[note('later',{start:200,length:1})]});reject(()=>midiPlan(later,40,0,0.25),/five-minute/);
});
await scenario('Keep MIDI accepts exact timeline end and rejects offset plus minimum source overflow',()=>{
 const exact=track({notes:[],offset:295.5}),data=arrangement(exact);
 eq(keepMidi(data,data,exact,[note('new',{start:0,length:0.25})]).tracks[0].notes.length,1);
 const beyond={...exact,offset:295.501},b=arrangement(beyond);
 reject(()=>keepMidi(b,b,beyond,[note('new',{start:0,length:0.25})]),/five-minute/);
});
await scenario('Keeping a longer sampler performance follows its new end without losing other fades',()=>{
 const t=track({fadeStart:0.5,fadeEnd:4.5,fadeIn:0.25,fadeOut:1}),data=arrangement(t);
 const kept=keepMidi(data,data,t,[note('later',{start:12,length:1})]).tracks[0];
 eq(kept.fadeEnd,undefined);eq(kept.fadeStart,0.5);eq(kept.fadeIn,0.25);eq(kept.fadeOut,1);
 const same=keepMidi(data,data,t,[note('inside',{start:1,length:0.25})]).tracks[0];eq(same.fadeEnd,4.5);
});
await scenario('Sampler source replacement and concurrent region edits merge as one conflict',()=>{
 const t=track(),b=freeze(snapshot(t));const local=freeze(snapshot({...t,fileId:'sample-b',sample:settings({start:0,end:1}),volume:0.5}));
 const remote=freeze(snapshot({...t,sample:settings({start:1,end:3}),pan:0.25}));
 for(const choice of [undefined,'local','remote']){
  const result=unchanged(()=>mergeProject(b,local,remote,choice),[b,local,remote]);
  eq(result.conflicts,['Sampler · instrument source and notes']);eq(source(result.project.data.tracks[0]),source((choice==='remote'?remote:local).data.tracks[0]));
  eq(result.project.data.tracks[0].volume,0.5);eq(result.project.data.tracks[0].pan,0.25);validateArrangement(result.project.data);checks++;
 }
});
await scenario('Concurrent sampler mode changes never leave half of a source mode',()=>{
 const t=track();const synth={...t,fileId:undefined,sample:undefined,sound:'bass'};
 const raw={...t,sample:undefined,notes:undefined,sound:undefined};
 const other={...t,sample:settings({rootPitch:48}),notes:[note('new')]};
 for(const replacement of [synth,raw])for(const choice of ['local','remote']){
  const result=mergeProject(snapshot(t),snapshot(replacement),snapshot(other),choice);
  eq(source(result.project.data.tracks[0]),source(choice==='local'?replacement:other));
  eq(result.conflicts,['Sampler · instrument source and notes']);validateArrangement(result.project.data);checks++;
 }
});
await scenario('Unilateral source changes and independent mixer edits merge cleanly and deeply clone',()=>{
 const t=track(),base=freeze(snapshot(t));const local=freeze(snapshot({...t,sample:settings({rootPitch:48})}));const remote=freeze(snapshot({...t,pan:0.25}));
 const result=mergeProject(base,local,remote);eq(result.conflicts,[]);eq(result.project.data.tracks[0].sample,local.data.tracks[0].sample);eq(result.project.data.tracks[0].pan,0.25);
 ok(result.project.data.tracks[0].sample!==local.data.tracks[0].sample);ok(result.project.data.tracks[0].notes!==local.data.tracks[0].notes);
 ok(!sameProject(base,local));const reordered=structuredClone(local);reordered.data.tracks[0].sample={release:0.08,attack:0.005,end:4,start:0,rootPitch:48};ok(sameProject(local,reordered));
});
await scenario('Concurrent note changes and source changes require an explicit sampler choice',()=>{
 const t=track();const local={...t,notes:[...t.notes,note('new')]};const remote={...t,sample:settings({end:2})};
 for(const choice of ['local','remote']){const result=mergeProject(snapshot(t),snapshot(local),snapshot(remote),choice);eq(result.conflicts.length,1);eq(source(result.project.data.tracks[0]),source(choice==='local'?local:remote));}
});
await scenario('Vocal punch helpers reject sampler and instrument targets before encoding',async()=>{
 const audio={sampleRate:48000,length:48000,numberOfChannels:1,getChannelData:()=>{throw Error('Encoding must not run');}};
 for(const t of [track(),track({notes:[]}),track({sample:undefined,notes:[]}),track({sample:undefined,notes:undefined,sequence:Array.from({length:3},()=>Array(16).fill(0))})]){
  reject(()=>checkPunchTarget(arrangement(t),t),/recorded audio/);
  await rejectAsync(()=>punchSeed(t,audio),/Punch-in currently/);
  reject(()=>applyPunchClip(arrangement(t),t,{}, {},'replacement',[]),/recorded audio/);
 }
 const raw=track({sample:undefined,notes:undefined});checkPunchTarget(arrangement(raw),raw);checks++;
 reject(()=>checkPunchTarget(arrangement({...raw,sample:settings(),notes:[]}),raw),/changed/);
});

function fakeContext(){
 const sources=[],gains=[];const c={currentTime:0,createBufferSource(){const src={events:[],rate:[],onended:null,playbackRate:{setValueAtTime(v,t){src.rate.push([v,t]);}},connect(node){src.connected=node;return node;},start(...args){src.events.push(['start',...args]);},stop(...args){src.events.push(['stop',...args]);},disconnect(){src.disconnected=(src.disconnected||0)+1;}};sources.push(src);return src;},createGain(){const g={events:[],connect(node){return node;},disconnect(){g.disconnected=(g.disconnected||0)+1;},gain:{setValueAtTime(...args){g.events.push(['set',...args]);},linearRampToValueAtTime(...args){g.events.push(['ramp',...args]);},cancelAndHoldAtTime(...args){g.events.push(['hold',...args]);}}};gains.push(g);return g;}};return {c,sources,gains};
}
await scenario('Sample scheduling uses source-region seconds, correct pitch rate, and output stop time',()=>{
 const {c,sources,gains}=fakeContext();let ended=0;const s=freeze(settings({start:1,end:3,attack:0.01,release:0.1}));
 const voice=unchanged(()=>playSample(c,{},buffer(),s,72,2,10,0.6,()=>ended++),s);
 eq(sources[0].rate,[[2,2]]);eq(sources[0].events,[['start',2,1,2],['stop',3]]);
 eq(gains[0].events,[['set',0,2],['ramp',0.3,2.01],['set',0.3,2.9],['ramp',0,3]]);
 const finish=sources[0].onended;finish();finish();voice.stop();eq(ended,1);eq(sources[0].disconnected,1);eq(gains[0].disconnected,1);
});
await scenario('Offline short-note gain agrees with the live attack value at note-off',()=>{
 const {c,gains}=fakeContext();playSample(c,{},buffer(),settings({attack:2,release:0.5}),60,0,0.01,1);
 eq(gains[0].events,[['set',0,0],['ramp',0.0025,0.01],['set',0.0025,0.01],['ramp',0,0.51]]);
});
await scenario('Live release during attack holds the current envelope and cannot double-release',()=>{
 const {c,sources,gains}=fakeContext();const voice=playSample(c,{},buffer(),settings({attack:2,release:0.5}),60,0,100);
 c.currentTime=0.01;voice.release();const first=structuredClone(gains[0].events);voice.release();eq(gains[0].events,first);
 eq(gains[0].events.slice(-2),[['hold',0.01],['ramp',0,0.51]]);eq(sources[0].events.at(-1),['stop',0.51]);
 voice.stop();ok(sources[0].disconnected===1);
});
await scenario('Zero release and natural exhaustion are bounded without duplicate cleanup',()=>{
 const {c,sources,gains}=fakeContext();let ended=0;const voice=playSample(c,{},buffer(),settings({end:0.01,attack:0,release:0}),60,0,1,1,()=>ended++);
 eq(sources[0].events.at(-1),['stop',0.01]);c.currentTime=0.009;voice.release();eq(sources[0].events.at(-1),['stop',0.009]);
 sources[0].onended();voice.release();voice.stop();eq(ended,1);eq(gains[0].disconnected,1);
});
await scenario('Playback rejects invalid user values before creating nodes',()=>{
 const {c,sources}=fakeContext();for(const [time,velocity] of [[-1,1],[NaN,1],[Infinity,1],[0,-1],[0,1.1],[0,NaN]])reject(()=>playSample(c,{},buffer(),settings(),60,time,1,velocity));
 reject(()=>playSample(c,{},buffer({duration:1}),settings(),60,0,1));eq(sources.length,0);
});
console.log(JSON.stringify({checks,passed,failed:failures.length,failures},null,2));if(failures.length)process.exitCode=1;
