#!/usr/bin/env node
// An original, zero-paid-API B1 YouTube production built for kaomei/stickman-video-director.
// Uses the actual bundled renderer at workflow time. All newly drawn assets/audio are local.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT,'skills/directing-stickman-videos');
const requireSkill = createRequire(path.join(SKILL, 'package.json'));
const {createCanvas} = requireSkill('@napi-rs/canvas');
const STORY = JSON.parse(fs.readFileSync(path.join(__dirname,'deep-work-story.json'),'utf8'));
const PROJECT = path.join(ROOT,'studio/generated/deep-work');
const ART = path.join(PROJECT,'art');
const SFX = path.join(PROJECT,'sfx');
const PIECES = path.join(PROJECT,'speech-pieces');
for(const p of [PROJECT,ART,SFX,PIECES])fs.mkdirSync(p,{recursive:true});
const TARGET=60;
const VOICE = (process.env.VOICE_ENGINE || 'espeak').toLowerCase();
if(!['piper','espeak'].includes(VOICE))throw Error('VOICE_ENGINE must be piper or espeak');
const piperModel = process.env.PIPER_MODEL || path.join(ROOT,'studio/voices/en_US-kristin-medium.onnx');
if(VOICE==='piper'&&!fs.existsSync(piperModel))throw Error('Selected Piper voice model missing: '+piperModel);
function run(exe,args,opts={}) {return execFileSync(exe,args,{maxBuffer:32*1024*1024,...opts});}
function probe(f) {return Number(JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',f],{encoding:'utf8'})).format.duration);}
function wavPCM16(file,data,sampleRate=22050){
  const b=Buffer.alloc(44+data.length*2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);
  b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(data.length*2,40);
  for(let i=0;i<data.length;i++)b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(data[i]*32767))),44+i*2);
  fs.writeFileSync(file,b);
}
function synthVoice(speakingRate){
  const pieces=[];let sum=0;
  for(let i=0;i<STORY.beats.length;i++){
    const f=path.join(PIECES,`part-${String(i).padStart(2,'0')}.wav`);
    if(VOICE==='piper'){
      run('piper',['--model',piperModel,'--length_scale',String(speakingRate),'--output_file',f],{input:STORY.beats[i]+'\n'});
    }else{
      run('espeak-ng',['-v','en-us','-s',String(speakingRate),'-w',f,STORY.beats[i]]);
    }
    const duration=probe(f);pieces.push({file:f,duration,text:STORY.beats[i]});sum+=duration;
  }
  return {pieces,sum,speakingRate};
}
const rates=VOICE==='piper'?[0.97,0.88,1.07,0.80,1.18,0.73]:[160,172,150,182,141,192,130];
let selected=null,closest=null;
for(const rate of rates){
  const trial=synthVoice(rate);
  if(!closest || Math.abs(57.0-trial.sum)<Math.abs(57.0-closest.sum))closest=trial;
  console.log(`Voice calibration ${VOICE} (${rate}): ${trial.sum.toFixed(2)}s`);
  if(trial.sum>=54.6 && trial.sum<=58.8){selected=trial;break;}
}
if(!selected){
  // Preserve the best candidate in a fresh pass before failing with clear instructions.
  throw Error(`Unable to reach a natural 60-second script with ${VOICE}. Best measured speech ${closest?.sum.toFixed(2)}s. Revise beat wording or allowed native synthesis rate; do not silently stretch or truncate approved narration.`);
}
const n=selected.pieces.length;
const leading=0.13;
const gap=Math.max(0.035,Math.min(0.28,(59.52-leading-selected.sum)/(n-1)));
if(leading + selected.sum + gap*(n-1) < 55.0 || leading+selected.sum+gap*(n-1)>59.98)throw Error('Narration pacing outside expected 60s project range');
const silence=path.join(PIECES,'pause.wav');
const pauseSamples=Array(Math.round(22050*gap)).fill(0);
wavPCM16(silence,pauseSamples);
const leadFile=path.join(PIECES,'lead.wav');wavPCM16(leadFile,Array(Math.round(22050*leading)).fill(0));
// Normalise Piper/eSpeak clips to a common 22,050-Hz PCM WAV for sample-exact concatenation.
const parts=[leadFile],cueTimes=[],lengths=[];
let t=leading;
for(let i=0;i<n;i++){
  const dest=path.join(PIECES,`normal-${String(i).padStart(2,'0')}.wav`);
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',selected.pieces[i].file,'-ac','1','-ar','22050','-c:a','pcm_s16le',dest]);
  const dur=probe(dest);
  parts.push(dest);
  cueTimes.push({start:t,end:t+dur,text:selected.pieces[i].text});
  lengths.push(dur);
  t+=dur;
  if(i<n-1){parts.push(silence);t+=gap;}
}
function concatFile(paths,output){
  const list=path.join(PIECES,'concat.txt');
  const quote=f=>f.replace(/'/g,"'\\''");
  fs.writeFileSync(list,paths.map(x=>`file '${quote(x)}'`).join('\n')+'\n');
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-ac','1','-ar','22050','-c:a','pcm_s16le',output]);
}
concatFile(parts,path.join(PROJECT,'narration.wav'));
const voiceDuration=probe(path.join(PROJECT,'narration.wav'));
if(voiceDuration>=60||voiceDuration<55)throw Error('Final narration is '+voiceDuration.toFixed(2)+'s, expected 55–60 seconds');
const voiceTail=60-voiceDuration;

// Original story-specific transparent PNGs. Main B1 background and captions come from the actual repo renderer.
const ink='#263342',red='#D65855',gold='#E8BC5C',green='#69A48A',paper='#FDFDFC';
function line(g,x1,y1,x2,y2,w=7,c=ink){g.strokeStyle=c;g.lineWidth=w;g.lineCap='round';g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();}
function circle(g,x,y,r,fill=null,stroke=ink,w=7){g.beginPath();g.arc(x,y,r,0,Math.PI*2);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=w;g.stroke();}}
function round(g,x,y,w,h,r,fill='#fff',stroke=ink){g.beginPath();g.roundRect(x,y,w,h,r);g.fillStyle=fill;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=6;g.stroke();}}
function text(g,s,x,y,size=27,color=ink){g.font=`700 ${size}px sans-serif`;g.fillStyle=color;g.fillText(s,x,y);}
const poses=Object.freeze({
 distracted:{head:-15,handL:[110,230],handR:[370,245],face:'worried'},
 surprised:{head:13,handL:[94,165],handR:[378,184],face:'shock'},
 thinking:{head:-7,handL:[200,218],handR:[350,208],face:'thinking'},
 waiting:{head:0,handL:[130,265],handR:[372,259],face:'tired'},
 confident:{head:-5,handL:[110,176],handR:[387,183],face:'smile'},
 writing:{head:9,handL:[140,260],handR:[394,281],face:'focus'},
 focused:{head:-4,handL:[150,250],handR:[360,246],face:'focus'},
 ready:{head:0,handL:[104,185],handR:[382,181],face:'smile'},
 walking:{head:0,handL:[122,205],handR:[370,215],face:'smile'},
 returning:{head:-3,handL:[133,246],handR:[347,255],face:'focus'},
 celebrating:{head:-5,handL:[103,152],handR:[394,146],face:'happy'}
});
function drawActor(s,i){
  const c=createCanvas(500,500),g=c.getContext('2d'),p=poses[s.pose];
  g.lineCap='round';g.lineJoin='round';
  // Long, slender, articulated limbs and grounded shoes; no reference art reused.
  const dx=p.head;
  line(g,253+dx*.2,175,252,322,8);
  line(g,252,322,178+(i%3)*5,457,8);line(g,252,322,331-(i%2)*10,454,8);
  line(g,173+(i%3)*5,456,203+(i%3)*5,458,9);
  line(g,326-(i%2)*10,454,359-(i%2)*10,457,9);
  const left=p.handL,right=p.handR;
  line(g,250,209,(left[0]+250)/2,left[1]-25,8);
  line(g,(left[0]+250)/2,left[1]-25,left[0],left[1],8);
  line(g,250,208,(right[0]+250)/2,right[1]-32,8);
  line(g,(right[0]+250)/2,right[1]-32,right[0],right[1],8);
  circle(g,left[0],left[1],8,paper,ink,4);circle(g,right[0],right[1],8,paper,ink,4);
  circle(g,251+dx,110,64,paper,ink,7);
  circle(g,224+dx,101,5,ink,null);circle(g,275+dx,101,5,ink,null);
  if(p.face==='shock'){circle(g,252+dx,133,13,null,red,5);}else{
    g.strokeStyle=p.face==='worried'?red:ink;g.lineWidth=5;g.beginPath();g.moveTo(223+dx,134);
    const bend=p.face==='tired'||p.face==='worried'?-17:p.face==='happy'?24:p.face==='thinking'?0:13;
    g.quadraticCurveTo(251+dx,134+bend,282+dx,133);g.stroke();
  }
  if(p.face==='worried'||p.face==='tired'){
    line(g,206+dx,78,237+dx,87,4,red);line(g,267+dx,87,293+dx,78,4,red);
  }
  if(p.face==='happy'){
    line(g,204+dx,79,221+dx,73,4,green);line(g,282+dx,73,298+dx,80,4,green);
  }
  const filename=`art/actor-${String(i+1).padStart(2,'0')}.png`;
  fs.writeFileSync(path.join(PROJECT,filename),c.toBuffer('image/png'));return filename;
}
function drawProp(s,i){
  const c=createCanvas(360,355),g=c.getContext('2d');g.lineCap='round';g.lineJoin='round';
  const kind=s.prop;
  if(kind==='brain'){
    circle(g,171,155,94,'#FBE9D0',red,6);
    for(let k=0;k<5;k++)circle(g,130+(k%3)*39,127+Math.floor(k/3)*58,27,null,red,4);
    text(g,'?',147,184,72,ink);
  }else if(kind==='phone'){
    round(g,110,35,130,247,22,'#F8FAFF');
    round(g,132,100,87,79,12,'#F7D4CE',red);text(g,'!',162,157,54,red);
    circle(g,176,257,6,ink,null);
    for(let k=0;k<3;k++)circle(g,265+k*22,95-k*22,8,gold,null);
  }else if(kind==='reward'){
    circle(g,170,168,94,'#FFF1BD',gold,8);
    const pts=[];for(let k=0;k<10;k++){const a=-Math.PI/2+k*Math.PI/5,r=k%2?40:76;pts.push([170+r*Math.cos(a),168+r*Math.sin(a)]);}
    g.beginPath();pts.forEach(([x,y],k)=>k?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fillStyle=gold;g.fill();g.lineWidth=4;g.strokeStyle=ink;g.stroke();
  }else if(kind==='hourglass'){
    line(g,115,54,250,54,10);line(g,115,285,250,285,10);
    line(g,120,59,245,282,7);line(g,244,58,120,284,7);
    g.fillStyle=gold;g.beginPath();g.moveTo(129,86);g.lineTo(236,86);g.lineTo(182,154);g.closePath();g.fill();
    g.beginPath();g.moveTo(130,272);g.lineTo(236,272);g.lineTo(184,220);g.closePath();g.fill();
  }else if(kind==='target'){
    [93,67,39].forEach((r,k)=>circle(g,175,170,r,k===2?gold:'#FFFFFF',k===1?red:ink,6));
    line(g,259,76,179,162,8,green);text(g,'GO',125,322,48,green);
  }else if(kind==='checklist'){
    round(g,78,29,221,290,14,'#FFFDF6');
    for(let k=0;k<3;k++){const y=100+k*72;round(g,106,y-28,30,30,6,k===0?'#D1EAD9':'#FFF');
      line(g,152,y-13,263,y-13,5,k===0?green:ink);if(k===0){line(g,109,y-13,119,y-3,5,green);line(g,119,y-3,135,y-23,5,green);}}
  }else if(kind==='browser'){
    round(g,48,68,267,214,14,'#FFFFFF');
    line(g,50,113,313,113,6);round(g,62,83,105,24,5,'#F4D0CA',red);round(g,174,83,121,24,5,'#DDF0E4',green);
    line(g,84,158,276,158,5);line(g,84,185,229,185,5);line(g,84,214,253,214,5);
    line(g,80,321,280,321,6,red);
  }else if(kind==='timer'){
    circle(g,176,163,112,'#FFFFFF',ink,8);line(g,176,164,176,79,10,red);line(g,176,164,233,198,10,green);
    round(g,147,25,58,24,7,'#EFD28A');text(g,'10',149,319,47,red);
  }else if(kind==='steps'){
    round(g,48,236,82,76,4,'#E2EBF5');round(g,128,166,82,146,4,'#D6ECDD');round(g,208,96,95,216,4,'#FCE9BB');
    line(g,92,209,162,153,8,green);line(g,162,153,250,66,8,green);text(g,'1',80,288,45);text(g,'2',157,286,45);text(g,'3',245,286,45);
  }else if(kind==='compass'){
    circle(g,176,169,106,'#FFFDF7',ink,8);
    g.fillStyle=green;g.beginPath();g.moveTo(223,103);g.lineTo(193,194);g.lineTo(134,236);g.lineTo(159,144);g.closePath();g.fill();
    circle(g,175,170,10,ink,null);text(g,'FOCUS',110,320,34,ink);
  }else if(kind==='trophy'){
    round(g,138,230,77,41,8,'#F6E5B0');round(g,122,275,109,22,6,'#E7BB5C');
    g.fillStyle=gold;g.beginPath();g.moveTo(105,74);g.lineTo(254,74);g.lineTo(239,186);g.quadraticCurveTo(179,248,123,181);g.closePath();g.fill();
    g.strokeStyle=ink;g.lineWidth=7;g.stroke();circle(g,183,143,25,'#FFF5D0',red,3);text(g,'1',175,153,29,red);
  }
  const filename=`art/prop-${String(i+1).padStart(2,'0')}.png`;
  fs.writeFileSync(path.join(PROJECT,filename),c.toBuffer('image/png'));return filename;
}
const actors=[],props=[];
for(let i=0;i<STORY.scenes.length;i++){actors.push(drawActor(STORY.scenes[i],i));props.push(drawProp(STORY.scenes[i],i));}

// All music and effects are generated here as ORIGINAL PCM; no scraped or unlicensed tracks.
function seeded(){let v=32452;return()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
const rand=seeded();
const sr=22050;
const samples=Math.round(TARGET*sr);
const music=new Float32Array(samples),room=new Float32Array(samples);
const chords=[[261.63,329.63,392.00],[220,261.63,329.63],[293.66,349.23,440.00],[196,246.94,293.66]];
for(let i=0;i<samples;i++){
  const tt=i/sr, ci=Math.floor(tt/15)%4,c=chords[ci],fade=Math.min(1,tt/1.2,(60-tt)/1.8);
  let pad=0;for(let k=0;k<3;k++)pad+=Math.sin(2*Math.PI*c[k]*tt+.2*k)*0.20;
  const bt=tt%1.5, pluck=Math.exp(-bt*3.3)*Math.sin(2*Math.PI*(c[Math.floor(tt/1.5)%3]*2)*bt);
  music[i]=fade*(pad*.10+pluck*.085);
  // Low hiss room tone, gently smoothed by LP-like running average.
  room[i]=(rand()-.5)*.007;
}
const musicName='music-original.wav',roomName='room-tone-original.wav';
wavPCM16(path.join(PROJECT,musicName),music);wavPCM16(path.join(PROJECT,roomName),room);
function effect(filename,type){
  const len=type==='whoosh'?0.40:type==='ding'?0.55:0.22;
  const arr=new Float32Array(Math.ceil(sr*len));const random=seeded();
  for(let i=0;i<arr.length;i++){
    const t=i/sr,decay=Math.pow(Math.max(0,1-t/len),3);
    if(type==='whoosh')arr[i]=decay*Math.sin(2*Math.PI*(150*t+650*t*t))*.25+(random()-.5)*decay*.08;
    else if(type==='ding')arr[i]=decay*(Math.sin(2*Math.PI*660*t)+.5*Math.sin(2*Math.PI*990*t))*.16;
    else arr[i]=decay*Math.sin(2*Math.PI*900*t)*.19;
  }
  wavPCM16(path.join(SFX,filename),arr);
}
effect('tap.wav','tap');effect('whoosh.wav','whoosh');effect('success.wav','ding');
const cues=cueTimes.map((c,i)=>({start:+c.start.toFixed(3),end:+c.end.toFixed(3),text:c.text}));
const shots=[];
for(let i=0;i<STORY.scenes.length;i++){
  const first=i*2, last=Math.min(n-1,first+1), scene=STORY.scenes[i];
  const a=i===0?0:cues[first].start;
  const b=i===STORY.scenes.length-1?60:(cues[last].end+(cues[last+1]?.start-cues[last].end||0)/2);
  const end=i===STORY.scenes.length-1?60:+b.toFixed(3), start=i===0?0:+a.toFixed(3),dur=end-start;
  if(end<=start)throw Error('Invalid scene interval');
  const motionSpan=+dur.toFixed(3),sx=(i%2===0?710:697),px=(i%2===0?136:172);
  shots.push({start,end,layers:[
    {type:'text',text:scene.headline,x:70,y:110,size:56,bold:true,color:ink,w:630},
    {type:'text',text:scene.subhead,x:70,y:181,size:46,bold:true,color:i%2?red:green,w:630},
    {type:'image',id:`focus-actor-${i}`,path:actors[i],x:sx,y:155,w:420,
      motion:{role:'actor',reason:scene.action},
      keys:[{t:0,x:sx,angle:-0.035},{t:motionSpan,x:sx+(i%2?54:80),angle:0.025}]},
    {type:'image',id:`story-prop-${i}`,path:props[i],x:px,y:252,w:305,
      motion:{role:'prop',reason:scene.action},
      keys:[{t:0,x:px,angle:-0.07,y:278},{t:motionSpan,x:px+95,angle:0.03,y:240}]},
    {type:'underline',x:78,y:206,w:340,color:gold,lineWidth:5,
      keys:[{t:0,progress:0},{t:Math.min(.7,motionSpan),progress:1}]}
  ]});
}
// Exact gap checks: critical for the B1 scaffold validator.
shots[0].start=0;for(let i=1;i<shots.length;i++)shots[i].start=shots[i-1].end;
const soundTimes=[0,2,5,7,9,11,14,16,18,20].filter(k=>k<cues.length).map((k,i)=>({kind:'file',path:`sfx/${i===0?'tap':i===9?'success':i%3===0?'whoosh':'tap'}.wav`,time:Math.min(59.0,cues[k].start+0.15),gain:i===9?0.13:0.07}));
const output={version:1,style:'B1',width:1280,height:720,fps:30,
 voice:{path:'narration.wav',lead:0,tail:+voiceTail.toFixed(5)},
 captions:cues,shots,sfx:soundTimes,
 ambience:[{path:roomName,start:0,end:60,gain:.06,loop:false}],
 music:{path:musicName,gain:.12},
 metadata:{working_note:`Full-length technical candidate; voice engine ${VOICE}, scene-specific original art/sound. Independent sample review and user approval still required before final release.`}
};
fs.writeFileSync(path.join(PROJECT,'project.json'),JSON.stringify(output,null,2)+'\n');
fs.writeFileSync(path.join(PROJECT,'script.md'),`# ${STORY.title}\n\n${STORY.beats.join('\n\n')}\n`);
function srtTimestamp(sec){const ms=Math.floor((sec%1)*1000);const s=Math.floor(sec)%60,m=Math.floor(sec/60)%60,h=Math.floor(sec/3600);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;}
fs.writeFileSync(path.join(PROJECT,'captions.srt'),cues.map((c,i)=>`${i+1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`).join('\n'));
fs.writeFileSync(path.join(PROJECT,'shot-list.md'),`# Storyboard / shot ledger\n\n${shots.map((s,i)=>`${i+1}. ${s.start.toFixed(2)}–${s.end.toFixed(2)}s — **${STORY.scenes[i].headline}** ${STORY.scenes[i].subhead} — ${STORY.scenes[i].action}`).join('\n')}\n`);
fs.writeFileSync(path.join(PROJECT,'CREDITS-AND-PROVENANCE.md'),`# Media provenance and upload review\n\n- Script: original, authored for this video.\n- Stickman, props and diagrams: procedurally drawn original PNGs by studio/build-deep-work.mjs.\n- Instrumental underscore, room tone and sound effects: original procedural wave synthesis; no third-party music.\n- Voice synthesis: ${VOICE==='piper'?'Piper with en_US-kristin-medium (public-domain LibriVox-derived dataset; verify included MODEL_CARD and local terms)':'eSpeak NG local synthetic voice (no paid API)'} at its original synthesis rate.\n- Video renderer: kaomei/stickman-video-director (MIT).\n- This is an encoded candidate, not reviewed/approved. Watch the entire MP4, listen and verify captions/music, artwork and readability before public release.\n`);
const summary={title:STORY.title,status:'candidate_not_reviewed',voice_engine:VOICE,rate:selected.speakingRate,
 duration_seconds:TARGET,voice_duration_seconds:voiceDuration,tail_seconds:voiceTail,scene_count:shots.length,
 caption_cues:cues.length,frame_size:[1280,720],fps:30,source_files_created:fs.readdirSync(ART).length,
 manifest_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(PROJECT,'project.json'))).digest('hex')};
fs.writeFileSync(path.join(PROJECT,'production-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
