import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Run from the Site root. This also works unchanged after copying to tests/.
const root = process.cwd();
const requireLocal = createRequire(path.join(root, 'package.json'));
const ts = requireLocal('typescript');
const loaded = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} }; loaded.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Number, Math, Array, Error,
    require(id) {
      if (!id.startsWith('.')) return requireLocal(id);
      let target = path.resolve(path.dirname(file), id);
      if (!path.extname(target)) target += '.ts';
      return load(target);
    },
  }, {filename:file});
  return module.exports;
}
const { loopPlan, loopSegments } = load('lib/loop-recording.ts');
const { recordingTiming } = load('lib/recording-timing.ts');
const worklet = fs.readFileSync(path.join(root, 'public/recording-worklet.js'), 'utf8');
let checks = 0, scenarios = 0;
const failures = [];
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const rejects = (fn, message) => { assert.throws(fn, message); checks++; };
function scenario(name, fn) {
  try { fn(); scenarios++; console.log('PASS '+name); }
  catch (error) { failures.push(name+': '+error.message); console.log('FAIL '+name+': '+error.message); }
}
function processor(rate) {
  const messages = []; let Type;
  const sandbox = {
    Float32Array, Number, Math, sampleRate:rate, currentFrame:0,
    AudioWorkletProcessor:class { constructor() { this.port = {postMessage:message=>messages.push(message)}; } },
    registerProcessor(name, T) { assert.equal(name,'session-capture'); Type=T; },
  };
  vm.runInNewContext(worklet,sandbox);
  const p=new Type();
  const send = data => p.port.onmessage({data});
  function block(frame,length=128,source=(absolute)=>Math.fround((absolute%16000)/32000),channels=1) {
    sandbox.currentFrame=frame;
    const input=Array.from({length:channels},(_,channel)=>Float32Array.from({length},(_,i)=>source(frame+i,channel)));
    const output=[new Float32Array(length).fill(9),new Float32Array(length).fill(-2)];
    const result=p.process([input],[output]);
    assert.ok(output.every(channel=>channel.every(value=>value===0)),'Microphone monitoring output was audible');
    return result;
  }
  function feed(first,last,source,sizes=[64,128,256],channels=1) {
    let next=first, index=0;
    while(next<last) {const length=Math.min(sizes[index++%sizes.length],last-next); if(block(next,length,source,channels)===false)break; next+=length;}
  }
  return {p,messages,send,block,feed,sandbox};
}
function collected(messages) {
  const passes=[]; let chunks=[];
  for(const m of messages) {
    if(m.type==='samples')chunks.push(m.samples);
    if(m.type==='pass') {
      const length=chunks.reduce((sum,c)=>sum+c.length,0), pcm=new Float32Array(length); let at=0;
      for(const chunk of chunks) {pcm.set(chunk,at);at+=chunk.length;}
      passes.push({index:m.index,frames:m.frames,pcm,chunks:chunks.map(c=>c.length)}); chunks=[];
    }
  }
  return {passes,trailing:chunks.reduce((sum,c)=>sum+c.length,0)};
}
const fakeTake=(seconds,size)=>({seconds,blob:{size}});

for(const rate of [44100,48000]) {
  const n=rate===44100?5516:6005;
  scenario(`${rate}: exact indexed passes, nonaligned boundaries and 4096 chunks`,()=>{
    const t=processor(rate), start=10037;
    const signal=absolute=>Math.fround((absolute-start)/(n*8));
    t.send({type:'arm',start,limit:n*3,cycle:n});
    t.feed(9984,start+n*3+257,signal);
    const {passes,trailing}=collected(t.messages);
    eq(passes.length,3,'Wrong pass count'); eq(trailing,0,'PCM remained after complete final pass');
    for(let i=0;i<3;i++) {
      eq(passes[i].index,i+1,'Out of order index'); eq(passes[i].frames,n,'Reported pass length'); eq(passes[i].pcm.length,n,'Actual pass length');
      eq(passes[i].chunks,[4096,n-4096],'Chunk crossed a pass boundary');
      ok(passes[i].pcm.every((value,j)=>value===signal(start+i*n+j)),'Missing, duplicate, or wrong-pass PCM');
    }
    const done=t.messages.filter(m=>m.type==='done'); eq(done.length,1,'Duplicate final completion'); eq(done[0].frames,n*3,'Wrong total completion frames');
    t.send({type:'finish'});t.block(start+n*3+257);eq(t.messages.filter(m=>m.type==='done').length,1,'Repeated finish duplicated completion');
    checks++; // block() checks every output quantum for silence.
  });
  scenario(`${rate}: correction longer than a pass does not accumulate`,()=>{
    const t=processor(rate), correction=Math.round(rate*.5), musical=9071, start=musical+correction;
    const signal=absolute=>Math.fround((absolute-start)/(n*8));
    t.send({type:'arm',start,limit:n*3,cycle:n});
    t.feed(musical-128,start,signal);
    eq(t.messages.filter(m=>m.type==='samples'||m.type==='pass').length,0,'Input before corrected start was retained');
    t.feed(start,start+n*3+128,signal);
    const {passes}=collected(t.messages); eq(passes.length,3,'Correction lost passes');
    for(let i=0;i<3;i++) {eq(passes[i].pcm[0],signal(start+i*n),'Correction accumulated between passes');eq(passes[i].pcm.at(-1),signal(start+(i+1)*n-1),'Corrected tail lost');}
  });
  scenario(`${rate}: scheduled stop retains only full passes and exposes truncated tail`,()=>{
    const t=processor(rate),start=12345,partial=Math.floor(n/2);
    t.send({type:'arm',start,limit:n*3,cycle:n});t.send({type:'finish',end:start+n+partial});
    t.feed(start-128,start+n*3,absolute=>Math.fround((absolute-start)/(n*8)));
    const {passes,trailing}=collected(t.messages);
    eq(passes.length,1,'Unfinished pass emitted a pass marker');eq(passes[0].frames,n,'Completed pass was truncated');eq(trailing,partial,'Wrong partial PCM length');
    eq(t.messages.find(m=>m.type==='done').frames,n+partial,'Stop frame not exact');
  });
  scenario(`${rate}: exact-boundary and pre-start stop avoid phantom passes`,()=>{
    for(const length of [0,n,n*2]) {
      const t=processor(rate),start=6000;t.send({type:'arm',start,limit:n*3,cycle:n});t.send({type:'finish',end:start+length});
      t.feed(start-128,start+n*3);t.send({type:'finish',end:start+length});
      const result=collected(t.messages);eq(result.passes.length,length/n,'Phantom or missing pass');eq(result.trailing,0,'Boundary stop produced trailing PCM');
      eq(t.messages.filter(m=>m.type==='done').length,1,'Stop completion duplicated');eq(t.messages.find(m=>m.type==='done').frames,length,'Boundary stop total');
    }
  });
  scenario(`${rate}: delayed finish reports actual received frames for receiver filtering`,()=>{
    const t=processor(rate),start=7000,requested=n*2-20,processed=n*2+19;
    t.send({type:'arm',start,limit:n*3,cycle:n});t.feed(start,start+processed);
    t.send({type:'finish',end:start+requested});
    const result=collected(t.messages),done=t.messages.filter(m=>m.type==='done');
    eq(result.passes.length,2,'Unexpected worklet pass marker history');eq(result.trailing,19,'Late control did not flush actual pending PCM');
    eq(done.length,1,'Late finish duplicate');eq(done[0].frames,processed,'Receiver cannot detect stop overrun');
    // The receiver must discard the second pass: its end is beyond requested.
    const eligible=result.passes.filter(pass=>pass.index*n<=requested);
    eq(eligible.length,1,'Requested-boundary full-pass filter');
    const old=t.messages.length;t.feed(start+processed,start+n*4);eq(t.messages.slice(old).filter(m=>['samples','pass','done'].includes(m.type)).length,0,'Late stop kept recording');
  });
  scenario(`${rate}: cancellation keeps published complete passes without finishing partial`,()=>{
    const t=processor(rate),start=5500;
    t.send({type:'arm',start,limit:n*3,cycle:n});t.feed(start,start+n+1000);
    const complete=collected(t.messages).passes[0].pcm.slice();
    t.send({type:'cancel'});const index=t.messages.length;t.send({type:'finish'});t.feed(start+n+1000,start+n*4);
    eq(collected(t.messages).passes.length,1,'Cancel altered complete pass count');eq(collected(t.messages).passes[0].pcm,complete,'Cancel mutated a completed pass');
    eq(t.messages.slice(index).filter(m=>['samples','pass','done'].includes(m.type)).length,0,'Cancel emitted stale PCM/completion');
  });
  scenario(`${rate}: silence, stereo downmix and invalid later-pass samples`,()=>{
    const silent=processor(rate);silent.send({type:'arm',start:1000,limit:n*2,cycle:n});silent.feed(872,1000+n*2+128,undefined,[128],0);
    const silence=collected(silent.messages);eq(silence.passes.length,2,'Silent input failed to record');ok(silence.passes.every(pass=>pass.pcm.every(value=>value===0)),'Silent input was not silent');
    const stereo=processor(rate);stereo.send({type:'arm',start:1000,limit:n*2,cycle:n});stereo.feed(872,1000+n*2+128,(_f,c)=>c?.2:.6,[128],2);
    ok(collected(stereo.messages).passes.every(pass=>pass.pcm.every(value=>Math.abs(value-.4)<1e-6)),'Stereo input was not averaged');
    for(const bad of [NaN,Infinity,-Infinity]) {
      const t=processor(rate),start=3000,badFrame=start+n+64;t.send({type:'arm',start,limit:n*3,cycle:n});
      t.feed(start,start+n*3,absolute=>absolute===badFrame?bad:.25,[128]);
      const result=collected(t.messages);eq(result.passes.length,1,'Invalid later pass lost or manufactured a complete pass');ok(result.passes[0].pcm.every(value=>value===.25),'Completed PCM damaged by later invalid sample');
      eq(t.messages.filter(m=>m.type==='error').length,1,'Invalid input error missing');eq(t.messages.filter(m=>m.type==='done').length,0,'Invalid input emitted successful completion');
    }
  });
  scenario(`${rate}: worklet rejects invalid cycles, counts and aggregate limits`,()=>{
    const cases=[
      {cycle:0,limit:n*2},{cycle:-1,limit:n*2},{cycle:NaN,limit:n*2},{cycle:Infinity,limit:n*2},{cycle:n+.5,limit:n*2},
      {cycle:Math.ceil(rate*.1)-1,limit:(Math.ceil(rate*.1)-1)*2},{cycle:rate*120+1,limit:(rate*120+1)*2},
      {cycle:n,limit:n},{cycle:n,limit:n*9},{cycle:n,limit:n*2+1},{cycle:rate*31,limit:rate*31*8},
      {cycle:n,limit:Infinity},{cycle:n,limit:NaN},{cycle:n,limit:-1},{cycle:n,limit:n*2+.5},
    ];
    for(const request of cases) {const t=processor(rate);t.send({type:'arm',start:1000,...request});eq(t.messages.at(-1)?.type,'error','Invalid loop was armed: '+JSON.stringify(request));t.feed(872,1600);eq(t.messages.filter(m=>m.type==='samples'||m.type==='pass').length,0,'Rejected arm emitted PCM');}
    for(const start of [-1,NaN,Infinity,10.5]) {const t=processor(rate);t.send({type:'arm',start,limit:n*2,cycle:n});eq(t.messages.at(-1)?.type,'error','Invalid start accepted');}
    const total=processor(rate);total.send({type:'arm',start:1000,cycle:rate*30,limit:rate*240});eq(total.messages.length,0,'Exact 240-second total rejected');
    const perPass=processor(rate);perPass.send({type:'arm',start:1000,cycle:rate*120,limit:rate*240});eq(perPass.messages.length,0,'Exact 120-second pass rejected');
  });
  scenario(`${rate}: planner quantization and count/duration capacity`,()=>{
    const plan=loopPlan(12.75,n/rate,3,rate);eq(plan.frames,n,'Planner lost integer frame');eq(plan.passes,3,'Planner changed pass count');eq(plan.sampleRate,rate,'Planner changed rate');
    eq(loopPlan(0,.1,2,rate).frames,Math.ceil(rate*.1),'Minimum pass length changed');
    eq(loopPlan(0,120,2,rate).frames,120*rate,'Maximum pass length changed');
    for(const passes of [0,1,9,-1,2.5,NaN,Infinity])rejects(()=>loopPlan(0,.5,passes,rate),'Invalid pass count');
    for(const seconds of [0,-1,.01,120+2/rate,NaN,Infinity])rejects(()=>loopPlan(0,seconds,2,rate),'Invalid pass length');
    for(const offset of [-1,NaN,Infinity,300])rejects(()=>loopPlan(offset,.5,2,rate),'Invalid project offset');
    const six=Array.from({length:6},()=>fakeTake(.1,100));eq(loopPlan(0,n/rate,2,rate,six).passes,2,'Last two slots rejected');
    rejects(()=>loopPlan(0,n/rate,3,rate,six),'Ninth take allowed');rejects(()=>loopPlan(0,n/rate,2,rate,[...six,fakeTake(.1,100)]),'Two passes fit one slot');
    const exactSeconds=240-2*n/rate;eq(loopPlan(0,n/rate,2,rate,[fakeTake(exactSeconds,100)]).passes,2,'Exact four-minute reservation rejected');
    rejects(()=>loopPlan(0,n/rate,2,rate,[fakeTake(exactSeconds+2/rate,100)]),'Duration budget overrun allowed');
    rejects(()=>loopPlan(0,31,8,rate),'Aggregate recording above four minutes allowed');
    const loopBytes=(n*4+58)*2,limit=48*1024*1024;eq(loopPlan(0,n/rate,2,rate,[fakeTake(.1,limit-loopBytes)]).passes,2,'Exact float-byte budget rejected');
    rejects(()=>loopPlan(0,n/rate,2,rate,[fakeTake(.1,limit-loopBytes+1)]),'Float-byte reservation exceeded');
  });
  scenario(`${rate}: finite backing segments share integer pass timing and retain silent bounds`,()=>{
    for(const offset of [0,.025,12.75,300-n/rate]) {
      const timing=recordingTiming(120,offset,1,rate,{preRollBars:2,correctionMs:500});
      const loop={offset,frames:n,passes:3,preRollFrames:timing.preRollFrames};
      const segments=loopSegments(loop,rate);eq(segments.length,3,'Wrong backing segment count');
      eq(segments[0].frame,0,'Initial backing did not begin at zero');
      ok(segments.every(s=>Number.isSafeInteger(s.frame)),'Backing schedule uses fractional frame');
      ok(segments[0].from>=0,'Pre-roll precedes project start');
      ok(Math.abs(segments[0].from-(offset-timing.preRollFrames/rate))<1e-12,'First pre-roll offset');
      for(let i=0;i<3;i++) {
        const segment=segments[i];eq(segment.to,offset+n/rate,'Silent tail or end-of-project bound was clamped');
        if(i) {eq(segment.frame,timing.preRollFrames+i*n,'Pass schedule gap/drift');eq(segment.from,offset,'Pre-roll repeated on later pass');}
        if(i<2)eq(Math.round((segment.to-segment.from)*rate)+segment.frame,segments[i+1].frame,'Adjacent backing segments do not meet');
      }
      eq(Math.round((segments.at(-1).to-segments.at(-1).from)*rate)+segments.at(-1).frame,timing.preRollFrames+3*n,'Final backing bound drift');
    }
    for(const preRollFrames of [-1,.5,NaN,Infinity,rate*12.75+1]) rejects(()=>loopSegments({offset:12.75,frames:n,passes:2,preRollFrames},rate),'Invalid pre-roll allowed');
    for(const frames of [n+.5,NaN,Infinity,-1,0]) rejects(()=>loopSegments({offset:12.75,frames,passes:2,preRollFrames:0},rate),'Invalid exact loop frames allowed');
    rejects(()=>loopSegments({offset:299.95,frames:n,passes:2,preRollFrames:0},rate),'Backing exceeds project bounds');
  });
}
scenario('unsupported sample rates are rejected by both planners',()=>{
  for(const rate of [0,22050,96000,NaN,Infinity]) {
    rejects(()=>loopPlan(0,.5,2,rate),'Unsupported sample rate planned');
    rejects(()=>loopSegments({offset:1,frames:12000,passes:2,preRollFrames:0},rate),'Unsupported sample rate scheduled');
  }
});
console.log(`${failures.length?'FAIL':'PASS'}: ${checks} loop processor/planner assertions in ${scenarios} passing scenarios; ${failures.length} failures.`);
if(failures.length) {for(const failure of failures)console.log('FINDING '+failure);process.exitCode=1;}
