import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const {loadTS}=await import(pathToFileURL(path.resolve('tests/load-ts.mjs')));
const {parseMidi,appendMidi,MIDI_FILE_LIMIT}=loadTS('lib/midi-import.ts');
const {defaults,midiFile}=loadTS('lib/audio.ts');
const {validateArrangement}=loadTS('lib/arrangement-validation.ts');
let checks=0,passed=0;const failures=[];
const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
const ok=(a,m)=>{assert.ok(a,m);checks++;};
const close=(a,b,m)=>{assert.ok(Math.abs(a-b)<1e-8,m||`${a} != ${b}`);checks++;};
const reject=(f,rx)=>{assert.throws(f,rx);checks++;};
async function scenario(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.log('FAIL '+name+': '+e.message);}}
const word=n=>[n>>>8&255,n&255],long=n=>[n>>>24&255,n>>>16&255,n>>>8&255,n&255];
function vlq(n){const b=[n&127];while(n=Math.floor(n/128))b.unshift((n&127)|128);return b;}
const text=s=>[...new TextEncoder().encode(s)];
const chunk=(name,data)=>text(name).concat(long(data.length),data);
const on=(at,pitch=60,velocity=100,channel=0)=>({at,data:[0x90|channel,pitch,velocity]});
const off=(at,pitch=60,channel=0)=>({at,data:[0x80|channel,pitch,0]});
const cc=(at,controller,value,channel=0)=>({at,data:[0xb0|channel,controller,value]});
const meta=(at,type,body)=>({at,data:[255,type,...vlq(body.length),...body]});
const tempo=(at,value)=>meta(at,81,[value>>>16&255,value>>>8&255,value&255]);
const port=(at,value)=>meta(at,33,[value]);
function track(events,end){let last=0,out=[];for(const e of [...events].sort((a,b)=>a.at-b.at)){out.push(...vlq(e.at-last),...e.data);last=e.at;}out.push(...vlq((end??last)-last),255,47,0);return chunk('MTrk',out);}
function file(tracks,options={}){return Uint8Array.from(chunk('MThd',word(options.format??(tracks.length>1?1:0)).concat(word(options.count??tracks.length),word(options.ppq??480),options.extraHeader??[])).concat(...tracks)).buffer;}
const basic=()=>file([track([on(0),off(480)])]);
const shape=notes=>notes.map(({id,...rest})=>rest);
const newNote=(patch={})=>({id:crypto.randomUUID(),pitch:60,start:0,length:1,velocity:0.75,...patch});
const part=(patch={})=>({id:crypto.randomUUID(),name:'Part',channel:1,port:0,notes:[newNote()],...patch});
const doc=(parts=[part()],patch={})=>({parts,bpm:120,variableTempo:false,warnings:[],...patch});
const choose=(d,sound='keys')=>d.parts.map(p=>({id:p.id,sound}));
const empty=bpm=>({bpm,tracks:[]});
const source=(patch={})=>({...defaults('Existing keys'),notes:[newNote()],sound:'keys',...patch});

await scenario('Format 0 imports notes, velocity-zero off, channel, and sanitized name',()=>{
 const d=parseMidi(file([track([meta(0,3,text(' Keys\u0000\n ')),on(0,60,32,2),on(480,60,0,2)])]));
 eq(d.parts.length,1);eq(d.parts[0].name,'Keys');eq(d.parts[0].channel,3);eq(d.parts[0].port,0);
 eq(shape(d.parts[0].notes),[{pitch:60,start:0,length:1,velocity:32/127}]);eq(d.bpm,120);eq(d.variableTempo,false);
});
await scenario('Each truncated prefix is rejected and original buffer is unchanged',()=>{
 const good=basic(),before=new Uint8Array(good).slice();for(let size=0;size<good.byteLength;size++)reject(()=>parseMidi(good.slice(0,size)));
 eq(new Uint8Array(good),before);eq(parseMidi(good).parts.length,1);
});
await scenario('File/header/chunk limits and unsupported timing are rejected',()=>{
 reject(()=>parseMidi(new ArrayBuffer(MIDI_FILE_LIMIT+1)),/2 MB/);
 for(const options of [{format:2},{format:3},{format:0,count:2},{count:0},{count:129},{ppq:0},{ppq:0xe728}])reject(()=>parseMidi(file([track([on(0),off(480)])],options)));
 const wrongTag=new Uint8Array(basic());wrongTag[0]=0;reject(()=>parseMidi(wrongTag.buffer),/Standard MIDI/);
 const hugeChunk=basic();new DataView(hugeChunk).setUint32(18,0xffffffff);reject(()=>parseMidi(hugeChunk),/length/);
 const shortHeader=Uint8Array.from(chunk('MThd',[0,0,0,1,0])).buffer;reject(()=>parseMidi(shortHeader),/header/);
 reject(()=>parseMidi(file([track([on(0),off(480)])],{format:1,count:2})),/track count/);
 reject(()=>parseMidi(file([track([on(0),off(480)]),track([on(0,62),off(480,62)])],{format:1,count:1})),/track count/);
});
await scenario('Extended header and unknown chunks are skipped by length',()=>{
 const d=parseMidi(file([chunk('JUNK',[1,2,3]),track([on(0),off(480)]),chunk('UNKN',[4,5])],{count:1,format:0,extraHeader:[1,2,3,4]}));
 eq(d.parts.length,1);eq(d.parts[0].notes[0].length,1);
});
await scenario('Running status supports note and single-data-byte channel events',()=>{
 const d=parseMidi(file([track([
  {at:0,data:[0xc0,1]},{at:0,data:[2]},{at:0,data:[0xd0,16]},{at:0,data:[32]},
  on(0,60,40),{at:240,data:[64,80]},{at:480,data:[60,0]},{at:720,data:[64,0]},
 ])]));
 eq(shape(d.parts[0].notes),[{pitch:60,start:0,length:1,velocity:40/127},{pitch:64,start:0.5,length:1,velocity:80/127}]);
 ok(d.warnings.some(w=>w.includes('instrument presets')));ok(d.warnings.some(w=>w.includes('controller')));
});
await scenario('Running status cannot start a track or cross metadata/SysEx/track boundaries',()=>{
 reject(()=>parseMidi(file([track([{at:0,data:[60,100]}])])),/running status/);
 for(const middle of [meta(0,1,text('text')),{at:0,data:[0xf0,1,0xf7]},{at:0,data:[0xf7,1,0x7e]}])
  reject(()=>parseMidi(file([track([on(0),middle,{at:480,data:[60,0]}])])),/running status/);
 reject(()=>parseMidi(file([track([on(0),off(480)]),track([{at:0,data:[60,100]}])])),/running status/);
});
await scenario('Malformed VLQ, meta sizes, data bytes and unsupported system messages fail',()=>{
 for(const raw of [
  [0x81,0x80,0x80,0x80,0,0x90,60,100,0,255,47,0],
  [0,0x90,128,100,0,255,47,0],[0,0x90,60,128,0,255,47,0],
  [0,255,81,2,1,2,0,255,47,0],[0,255,81,3,0,0,0,0,255,47,0],
  [0,255,33,2,0,1,0,255,47,0],[0,255,88,3,4,2,24,0,255,47,0],
  [0,255,1,127,0,255,47,0],[0,0xf0,127,0,255,47,0],
  [0,0xf8,0,255,47,0],[0,0xf2,0,0,0,255,47,0],
 ])reject(()=>parseMidi(file([chunk('MTrk',raw)])));
});
await scenario('End-of-track is required, empty, and final within its chunk',()=>{
 for(const raw of [[0,0x90,60,100],[0,0x90,60,100,0,255,47,1,0],[0,0x90,60,100,0,255,47,0,0]])
  reject(()=>parseMidi(file([chunk('MTrk',raw)])),/end-of-track/);
});
await scenario('Skipped SysEx and metadata do not lose delta timing',()=>{
 const d=parseMidi(file([track([on(0),{at:120,data:[0xf0,3,1,2,0xf7]},meta(240,1,text('hello')),
  {at:360,data:[0xf7,2,0xff,0xfe]},off(480),meta(480,88,[3,2,24,8]),meta(480,2,text('Copyright'))]) ]));
 eq(d.parts[0].notes[0].length,1);ok(d.warnings.some(w=>w.includes('System-exclusive')));ok(d.warnings.some(w=>w.includes('4/4')));ok(d.warnings.some(w=>w.includes('Copyright')));
});
await scenario('Multitrack sustain operates by channel before part selection',()=>{
 const d=parseMidi(file([track([cc(0,64,127),cc(960,64,0)],1920),track([meta(0,3,text('Piano')),on(0),off(480)],480),track([on(0,65,100,1),off(480,65,1)],480)]));
 eq(d.parts.length,2);eq(d.parts.find(p=>p.name==='Piano').notes[0].length,2);eq(d.parts.find(p=>p.channel===2).notes[0].length,1);
});
await scenario('Logical MIDI ports isolate otherwise matching controllers and pitches',()=>{
 const d=parseMidi(file([track([port(0,0),cc(0,64,127),cc(960,64,0)]),track([port(0,0),on(0),off(480)]),track([port(0,1),on(0),off(480)])]));
 eq(d.parts.find(p=>p.port===0).notes[0].length,2);eq(d.parts.find(p=>p.port===1).notes[0].length,1);
});
await scenario('CC120, CC121 and CC123 have distinct sustain and key-release behavior',()=>{
 for(const control of [120,121,123]){
  const d=parseMidi(file([track([cc(0,64,127),on(0,60),on(0,62),on(0,64,100,1),off(240,60),cc(480,control,0),off(720,62),cc(960,64,0),off(1200,64,1)])]));
  const main=d.parts.find(p=>p.channel===1).notes;
  eq(main.map(n=>[n.pitch,n.length]),control===120?[[60,1],[62,1]]:control===121?[[60,1],[62,1.5]]:[[60,2],[62,2]]);
  eq(d.parts.find(p=>p.channel===2).notes[0].length,2.5);
 }
});
await scenario('All Sound Off does not clear the sustain controller for later notes',()=>{
 const d=parseMidi(file([track([cc(0,64,127),on(0,60),cc(480,120,0),on(600,64),off(720,64),cc(960,64,0)])]));
 eq(d.parts[0].notes.map(n=>[n.pitch,n.length]),[[60,1],[64,0.75]]);
});
await scenario('Same-pitch overlapping voices use arrival-order note-off pairing',()=>{
 const d=parseMidi(file([track([on(0,60,32),on(480,60,80),off(960),off(1440)])]));
 eq(d.parts[0].notes.map(n=>[n.start,n.length,n.velocity]),[[0,2,32/127],[1,2,80/127]]);ok(d.warnings.some(w=>w.includes('arrival order')));
});
await scenario('Cross-track note-offs can release earlier notes without moving their ownership',()=>{
 const d=parseMidi(file([track([meta(0,3,text('A')),on(0,60,32)],0),track([meta(0,3,text('B')),on(480,60,80),off(960),off(1440)])]));
 eq(d.parts.find(p=>p.name==='A').notes[0].length,2);eq(d.parts.find(p=>p.name==='B').notes[0].length,2);
});
await scenario('Same-tick off/on ordering retains both repeated notes',()=>{
 const d=parseMidi(file([track([on(0),off(480),on(480),off(960)])]));eq(d.parts[0].notes.map(n=>[n.start,n.length]),[[0,1],[1,1]]);
});
await scenario('Unmatched releases are ignored and unfinished notes close at global file end',()=>{
 const d=parseMidi(file([track([off(0,59),on(0)],480),track([meta(1920,1,text('End'))],1920)]));
 eq(d.parts[0].notes.length,1);eq(d.parts[0].notes[0].length,4);ok(d.warnings.some(w=>w.includes('still held')));
 reject(()=>parseMidi(file([track([off(480)])])),/no MIDI notes/);
});
await scenario('Short notes are normalized with a notice and excessive musical parts are unavailable',()=>{
 const small=parseMidi(file([track([on(0),off(1)])]));eq(small.parts[0].notes[0].length,0.01);ok(small.warnings.some(w=>w.includes('minimum')));
 const early=parseMidi(file([track([on(256*480),off(257*480)])]));eq(early.parts[0].issue,undefined);
 const late=parseMidi(file([track([on(257*480),off(258*480)])]));ok(late.parts[0].issue?.includes('256 beats'));
 const longNote=parseMidi(file([track([on(0),off(33*480)])]));ok(longNote.parts[0].issue?.includes('32 beats'));
 const many=[];for(let i=0;i<257;i++)many.push(on(i*2),off(i*2+1));const over=parseMidi(file([track(many)]));eq(over.parts[0].notes.length,257);ok(over.parts[0].issue?.includes('256 notes'));
 const drum=parseMidi(file([track([on(0,36,100,9),off(480,36,9)])]));ok(drum.parts[0].issue?.includes('Drum'));
});
await scenario('Constant and variable tempo detection includes the default leading tempo',()=>{
 const constant=parseMidi(file([track([tempo(0,1000000),on(0),tempo(240,1000000),off(480)])]));eq(constant.bpm,60);eq(constant.variableTempo,false);
 const later=parseMidi(file([track([on(0),tempo(240,1000000),off(480)])]));eq(later.bpm,120);eq(later.variableTempo,true);
 const unchanged=parseMidi(file([track([on(0),tempo(240,500000),off(480)])]));eq(unchanged.bpm,120);eq(unchanged.variableTempo,false);
 const changed=parseMidi(file([track([tempo(0,1000000),on(0),tempo(240,500000),off(480)])]));eq(changed.bpm,60);eq(changed.variableTempo,true);ok(changed.warnings.some(w=>w.includes('Tempo changes')));
});
await scenario('Only the final tempo at a shared tick changes the effective tempo map',()=>{
 const d=parseMidi(file([track([tempo(0,500000),on(0),tempo(240,1000000),tempo(240,500000),off(480)])]));
 eq(d.variableTempo,false,'Zero-duration intermediate tempo should not classify a constant-tempo file as variable');eq(d.bpm,120);
});
await scenario('Initial tempo shared across tracks uses deterministic final tick-zero value',()=>{
 const d=parseMidi(file([track([tempo(0,1000000)]),track([tempo(0,500000),on(0),off(480)])]));eq(d.bpm,120);eq(d.variableTempo,false);
});
await scenario('Event, simultaneous-voice, part and timeline bounds stop pathological files',()=>{
 const repeated=[];for(let i=0;i<50001;i++)repeated.push(cc(0,1,0));reject(()=>parseMidi(file([track(repeated)])),/too many events/);
 const manyNotes=[];for(let i=0;i<10001;i++)manyNotes.push(on(0),off(0));reject(()=>parseMidi(file([track(manyNotes)])),/too many notes/);
 const held=[];for(let i=0;i<2049;i++)held.push(on(0,i%128,100,(Math.floor(i/128))%16));reject(()=>parseMidi(file([track(held,480)])),/simultaneous/);
 const parts=Array.from({length:65},()=>track([on(0),off(480)]));reject(()=>parseMidi(file(parts)),/64 note-bearing/);
 reject(()=>parseMidi(file([track([on(1000001),off(1000002)])],{ppq:1})),/timeline is too long/);
});
await scenario('An unavailable source part does not block selecting another valid part',()=>{
 const d=parseMidi(file([track([meta(0,3,text('Too long')),on(0),off(33*480)]),track([meta(0,3,text('Valid')),on(0,64),off(480,64)])]));
 const valid=d.parts.find(p=>p.name==='Valid'),unavailable=d.parts.find(p=>p.name==='Too long');
 ok(unavailable.issue);eq(appendMidi(empty(120),120,d,[{id:valid.id,sound:'keys'}],0,false).tracks.length,1);
 reject(()=>appendMidi(empty(120),120,d,choose(d),0,false),/available/);
});
await scenario('Append preserves file-relative alignment at the chosen insertion time',()=>{
 const d=parseMidi(file([track([on(960),off(1440)]),track([on(1920,64),off(2400,64)])]));
 const before=structuredClone(d),base={bpm:92,tracks:[source({name:'Original'})]},baseBefore=structuredClone(base);
 const out=appendMidi(base,92,d,[{id:d.parts[0].id,sound:'bass'},{id:d.parts[1].id,sound:'pad'}],12,false);
 eq(out.bpm,92);eq(out.tracks.length,3);eq(out.tracks.slice(1).map(t=>[t.offset,t.notes[0].start,t.sound]),[[12,2,'bass'],[12,4,'pad']]);
 eq(out.tracks[0],base.tracks[0]);eq(base,baseBefore);eq(d,before);ok(out.tracks[1].notes!==d.parts[0].notes);ok(out.tracks[1].notes[0]!==d.parts[0].notes[0]);
 validateArrangement(out,true);checks++;
});
await scenario('File-tempo adoption requires an empty project and valid constant tempo',()=>{
 const d=doc(undefined,{bpm:60}),choices=choose(d);eq(appendMidi(empty(92),92,d,choices,2,true).bpm,60);eq(appendMidi(empty(92),92,d,choices,2,false).bpm,92);
 reject(()=>appendMidi({bpm:92,tracks:[source()]},92,d,choices,0,true),/empty project/);
 for(const patch of [{variableTempo:true},{bpm:39},{bpm:241},{bpm:NaN},{bpm:Infinity}])reject(()=>appendMidi(empty(92),92,{...d,...patch},choices,0,true));
});
await scenario('Append rejects changed tempo, empty/duplicate/unknown choices and unsupported sounds',()=>{
 const d=doc(),choices=choose(d);reject(()=>appendMidi(empty(121),120,d,choices,0,false),/tempo changed/);
 reject(()=>appendMidi(empty(120),120,d,[],0,false),/at least one/);reject(()=>appendMidi(empty(120),120,d,[...choices,...choices],0,false),/only once/);
 reject(()=>appendMidi(empty(120),120,d,[{id:'missing',sound:'keys'}],0,false),/available/);reject(()=>appendMidi(empty(120),120,d,[{id:d.parts[0].id,sound:'external-plugin'}],0,false),/available/);
 const unavailable=doc([part({issue:'Too long'})]);reject(()=>appendMidi(empty(120),120,unavailable,choose(unavailable),0,false),/available/);
 for(const offset of [-1,300,NaN,Infinity])reject(()=>appendMidi(empty(120),120,d,choices,offset,false),/insertion time/);
});
await scenario('Track capacity is rechecked against the current project and add cannot replay',()=>{
 const d=doc(),choices=choose(d),base={bpm:120,tracks:Array.from({length:31},(_,i)=>source({name:'Track '+i}))};
 const out=appendMidi(base,120,d,choices,0,false);eq(out.tracks.length,32);reject(()=>appendMidi(out,120,d,choices,0,false));
 const other=doc();reject(()=>appendMidi(out,120,other,choose(other),0,false),/32 tracks/);
});
await scenario('Five-minute checks include source length, insertion time and synthesis tail',()=>{
 const d=doc([part({notes:[newNote({start:250,length:1})]})]);
 const accepted=appendMidi(empty(120),120,d,choose(d),174,false);eq(accepted.tracks[0].offset,174);
 reject(()=>appendMidi(empty(120),120,d,choose(d),174.001,false),/five-minute/);
 const short=doc();reject(()=>appendMidi(empty(120),120,short,choose(short),296,false),/five-minute/);
 eq(appendMidi(empty(120),120,short,choose(short),295.5,false).tracks.length,1);
});
await scenario('Whole-project render memory accounts for existing generated tracks',()=>{
 const sparse=()=>part({notes:[newNote({start:256,length:32})]}),d=doc(Array.from({length:4},sparse));
 eq(appendMidi(empty(240),240,d,choose(d),0,false).tracks.length,4);
 const five=doc([...d.parts,sparse()]);reject(()=>appendMidi(empty(240),240,five,choose(five),0,false),/audio memory/);
 const prior={bpm:240,tracks:[source({notes:[newNote({start:256,length:32})]})]};reject(()=>appendMidi(prior,240,d,choose(d),0,false),/audio memory/);
});
await scenario('Render memory scales with 96kHz and192kHz device rates',()=>{
 const sparse=()=>part({notes:[newNote({start:256,length:32})]});
 for(const [rate,allowed] of [[96000,2],[192000,1]]){
  const accepted=doc(Array.from({length:allowed},sparse));eq(appendMidi(empty(240),240,accepted,choose(accepted),0,false,rate).tracks.length,allowed);
  const rejected=doc([...accepted.parts,sparse()]);reject(()=>appendMidi(empty(240),240,rejected,choose(rejected),0,false,rate),/audio memory/);
 }
});
await scenario('Lower device rates cannot under-budget44100Hz automatic enrichment',()=>{
 const d=doc(Array.from({length:6},()=>part({notes:[newNote({start:256,length:32})]})));
 for(const rate of [3000,16000,32000])reject(()=>appendMidi(empty(240),240,d,choose(d),0,false,rate),/audio memory/);
});
await scenario('Append rejects invalid device rates and accepts supported rate edges',()=>{
 const d=doc();for(const rate of [NaN,Infinity,-Infinity,0,-1,2999,384001])reject(()=>appendMidi(empty(120),120,d,choose(d),0,false,rate));
 for(const rate of [3000,384000])eq(appendMidi(empty(120),120,d,choose(d),0,false,rate).tracks.length,1);
});
await scenario('Append validates notes and serialized size independently of parser issue metadata',()=>{
 for(const patch of [{pitch:128},{start:257},{length:33},{velocity:NaN}]){const d=doc([part({notes:[newNote(patch)]})]);reject(()=>appendMidi(empty(240),240,d,choose(d),0,false),/Invalid instrument note/);}
 const excessive=doc([part({notes:Array.from({length:257},()=>newNote())})]);reject(()=>appendMidi(empty(120),120,excessive,choose(excessive),0,false),/256 notes/);
 const large=doc(Array.from({length:32},()=>part({notes:Array.from({length:100},()=>newNote())})));reject(()=>appendMidi(empty(120),120,large,choose(large),0,false),/too large/);
});
await scenario('SESSION MIDI export imports back with exact tick timing and velocities',async()=>{
 const notes=[newNote({pitch:0,start:0,length:0.25,velocity:1/127}),newNote({pitch:64,start:2.5,length:1.5,velocity:32/127}),newNote({pitch:127,start:8,length:2,velocity:1})];
 const d=parseMidi(await midiFile(notes,120).arrayBuffer());eq(d.parts.length,1);eq(shape(d.parts[0].notes),shape(notes));eq(d.bpm,120);eq(d.variableTempo,false);
});

console.log(`\nMIDI import: ${checks} assertions, ${passed} scenarios passed, ${failures.length} failed.`);
if(failures.length){for(const failure of failures)console.error(failure);process.exitCode=1;}
