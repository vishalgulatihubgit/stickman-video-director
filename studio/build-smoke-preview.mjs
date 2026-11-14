// Original offline B1 technical preview generator; not a publish-ready film.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skill=path.join(root,'skills/directing-stickman-videos');
const requireSkill=createRequire(path.join(skill,'package.json'));
const {createCanvas}=requireSkill('@napi-rs/canvas');
const project=path.join(root,'studio/generated/demo'),art=path.join(project,'art');
fs.mkdirSync(art,{recursive:true});
const captions=['Your phone is buzzing.','Your attention slips away.','But focus is a choice.','Turn off the distractions.','Choose just one task.','Start with ten minutes.'];
const headlines=['A DISTRACTION.','FOCUS SLIPS.','MAKE A CHOICE.','LESS NOISE.','ONE TASK.','TEN MINUTES.'];
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'pipe'});
const duration=f=>Number(JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',f]).toString()).format.duration);
const asset=(i)=>{
 const c=createCanvas(500,480),g=c.getContext('2d');g.lineCap='round';g.lineJoin='round';g.strokeStyle='#1d2938';g.lineWidth=9;
 const line=(x,y,x2,y2)=>{g.beginPath();g.moveTo(x,y);g.lineTo(x2,y2);g.stroke()};
 g.beginPath();g.arc(250,100,52,0,Math.PI*2);g.stroke();
 g.fillStyle='#1d2938';g.beginPath();g.arc(232,94,5,0,7);g.arc(270,94,5,0,7);g.fill();
 g.beginPath();g.moveTo(227,126);g.quadraticCurveTo(250,i<2?113:145,275,126);g.stroke();
 line(250,152,250,310);line(250,310,170,427);line(250,310,337,427);
 line(250,194,165,262);line(165,262,112,i<2?245:205);line(250,194,337,263);line(337,263,395,i<2?246:208);
 g.fillStyle='#f2cf74';g.beginPath();g.arc(440,77,28,0,7);g.fill();g.fillStyle='#1d2938';g.font='bold 32px sans-serif';g.fillText(i<2?'!':'✓',430,89);
 const out='art/character-'+i+'.png';fs.writeFileSync(path.join(project,out),c.toBuffer('image/png'));return out;
};
const wavs=[],times=[],files=[];
for(let i=0;i<captions.length;i++){
 files.push(asset(i));const file=path.join(art,'speech-'+i+'.wav');run('espeak-ng',['-v','en-us','-s','143','-w',file,captions[i]]);wavs.push(file);times.push(duration(file));
}
fs.writeFileSync(path.join(art,'concat.txt'),wavs.map(f=>`file '${path.basename(f)}'`).join('\n')+'\n');
run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(art,'concat.txt'),'-c:a','pcm_s16le',path.join(project,'narration.wav')]);
const end=duration(path.join(project,'narration.wav'));
// Original quiet room-tone ambience
run('ffmpeg',[
  '-hide_banner','-loglevel','error','-y',
  '-f','lavfi',
  '-i','anoisesrc=color=pink:amplitude=0.04:sample_rate=44100',
  '-t',String(end+0.25),
  '-af','lowpass=f=420',
  '-c:a','pcm_s16le',
  path.join(project,'ambience.wav')
]);
let start=0;const shots=[],cues=[];
for(let i=0;i<captions.length;i++){
 const stop=i===captions.length-1?end:Math.min(end,start+times[i]),span=stop-start;
 shots.push({start,end:stop,layers:[
  {type:'text',text:headlines[i],x:100,y:165,size:73,bold:true,color:'#253348'},
  {type:'image',id:'actor-'+i,path:files[i],x:550,y:160,w:450,motion:{role:'actor',reason:'The stick figure changes position to illustrate the narrated idea'},keys:[{t:0,x:550,angle:-.035},{t:span,x:690,angle:.035}]}
 ]});
 cues.push({start,end:stop,text:captions[i]});start=stop;
}
const manifest={version:1,style:'B1',width:1280,height:720,fps:30,voice:{path:'narration.wav',lead:0,tail:0},captions:cues,shots,sfx:[],
ambience:[{
  path:'ambience.wav',
  start:0,
  end,
  gain:0.08,
  loop:false
}],
metadata:{working_note:'TECHNICAL SMOKE PREVIEW ONLY: robotic offline voice, coarse caption alignment, no licensed music, pending human creative review.'}};
fs.writeFileSync(path.join(project,'project.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Created ${project}, duration=${end.toFixed(2)}s, ${shots.length} scenes`);
