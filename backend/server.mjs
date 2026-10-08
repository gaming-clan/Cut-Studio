import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const localModel = process.env.LM_STUDIO_MODEL || 'google/gemma-4-e4b';
const localCli = process.env.LM_STUDIO_CLI || (process.platform === 'win32' ? 'lms.exe' : 'lms');
const execFileAsync = promisify(execFile);
const dataRoot = path.resolve(process.env.CUT_STUDIO_DATA || 'data');
const uploadRoot = path.join(dataRoot, 'uploads');
const exportRoot = path.join(dataRoot, 'exports');
await mkdir(uploadRoot, { recursive: true });
await mkdir(exportRoot, { recursive: true });

async function probe(file) {
  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', ['-v','error','-show_streams','-show_format','-of','json',file], { maxBuffer: 4 * 1024 * 1024 });
  const value = JSON.parse(stdout);
  const video = value.streams.find(s => s.codec_type === 'video');
  const audio = value.streams.find(s => s.codec_type === 'audio');
  if (!video && !audio) throw new Error('No audio or video stream was found.');
  const rotation = Number(video?.side_data_list?.find(s => Number.isFinite(Number(s.rotation)))?.rotation || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  const fpsParts = (video?.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: Number(value.format.duration || video?.duration || audio?.duration || 0),
    width: video ? (rotated ? video.height : video.width) : null,
    height: video ? (rotated ? video.width : video.height) : null,
    rotation,
    fps: fpsParts[1] ? fpsParts[0] / fpsParts[1] : 0,
    videoCodec: video?.codec_name || null,
    pixelFormat: video?.pix_fmt || null,
    sampleAspectRatio: video?.sample_aspect_ratio || null,
    videoDuration: Number(video?.duration || value.format.duration || 0),
    audio: Boolean(audio),
    audioCodec: audio?.codec_name || null,
    audioDuration: Number(audio?.duration || 0),
    audioChannels: audio?.channels || 0,
    audioChannelLayout: audio?.channel_layout || null,
    audioSampleRate: Number(audio?.sample_rate || 0),
    sizeBytes: Number(value.format.size || 0),
    container: value.format.format_name || null,
  };
}
async function ffmpeg(args, options = {}) {
  try { return await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-y',...args], { maxBuffer: 12 * 1024 * 1024, ...options }); }
  catch (error) { throw new Error((error.stderr || error.message || 'FFmpeg failed').slice(-3000)); }
}
function runLocalChat(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(localCli, ['chat', localModel, '--reasoning', 'off', '-p', prompt, '-s', 'Give one short sentence only. Do not reason aloud.', '--ttl', '3600'], { windowsHide: true });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error(`Local model ${localModel} timed out.`)); }, 3 * 60 * 1000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 512 * 1024) { child.kill(); finish(new Error('Local model output exceeded 512 KB.')); } });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 512 * 1024) stderr = stderr.slice(-512 * 1024); });
    child.on('error', error => finish(new Error(`Could not start LM Studio CLI (${localCli}): ${error.message}`)));
    child.on('close', code => code === 0 ? finish(null, {stdout, stderr}) : finish(new Error(stderr.trim() || `LM Studio CLI exited with code ${code}.`)));
    child.stdin.end();
  });
}
function assetPath(id) { if (!/^[a-f0-9-]{36}$/.test(String(id))) throw new Error('Invalid media id.'); return path.join(uploadRoot, `${id}.media`); }
function sendJson(res, status, value) { res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(value)); }
async function readJson(req, limit=200_000) { let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > limit) throw new Error('Request is too large.'); } return JSON.parse(raw); }

async function transcribeMedia(source) {
  const audioDir = await mkdtemp(path.join(tmpdir(), 'cutstudio-caption-'));
  try {
    await ffmpeg(['-i', source, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', path.join(audioDir, 'chunk-%03d.mp3')]);
    const chunks = (await readdir(audioDir)).filter(name => name.endsWith('.mp3')).sort();
    const segments = [];
    for (let index = 0; index < chunks.length; index++) {
      const bytes = await readFile(path.join(audioDir, chunks[index]));
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), chunks[index]);
      form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Transcription failed.');
      for (const segment of payload.segments || []) segments.push({
        start: Number(segment.start) + index * 600,
        end: Number(segment.end) + index * 600,
        text: String(segment.text || '').trim(),
      });
    }
    return segments;
  } finally {
    await rm(audioDir, { recursive: true, force: true });
  }
}

async function sampleFrames(source, start, end, count = 2) {
  const frameDir = await mkdtemp(path.join(tmpdir(), 'cutstudio-frames-'));
  try {
    const span = Math.max(0, end - start);
    const times = span <= 0.25 ? [start] : Array.from({ length: count }, (_, index) => start + span * ((index + 1) / (count + 1)));
    const frames = [];
    for (let index = 0; index < times.length; index++) {
      const output = path.join(frameDir, `frame-${index}.jpg`);
      await ffmpeg(['-ss', String(times[index]), '-i', source, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '6', output]);
      frames.push({ time: times[index], data: (await readFile(output)).toString('base64') });
    }
    return frames;
  } finally {
    await rm(frameDir, { recursive: true, force: true });
  }
}

const assetMime = new Map();
const schema = {
  type: 'object', additionalProperties: false, required: ['title', 'summary', 'steps', 'editDecisions'],
  properties: {
    title: { type: 'string' }, summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['order', 'action', 'detail'], properties: {
        order: { type: 'integer' }, action: { type: 'string' }, detail: { type: 'string' }
      } }
    },
    editDecisions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['clipIndex', 'position', 'keep', 'inPoint', 'outPoint', 'reason'], properties: {
        clipIndex: { type: 'integer' }, position: { type: 'integer' }, keep: { type: 'boolean' },
        inPoint: { type: 'number' }, outPoint: { type: 'number' }, reason: { type: 'string' },
      } }
    },
  }
};

const server = createServer(async (req, res) => {
  const origin=req.headers.origin;
  const localOrigin=origin && (origin==='http://localhost' || origin==='https://localhost' || origin==='http://127.0.0.1' || origin==='https://127.0.0.1' || origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:') || origin.startsWith('http://127.0.0.1:') || origin.startsWith('https://127.0.0.1:'));
  if(origin && (process.env.ALLOWED_ORIGIN ? origin===process.env.ALLOWED_ORIGIN : localOrigin)) {
    res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin');
  } else if(origin) { res.writeHead(403).end('Origin not allowed'); return; }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ok: true, configured: Boolean(process.env.OPENAI_API_KEY), localModel})); return;
  }
  const mediaMatch = req.url?.match(/^\/api\/media\/([a-f0-9-]{36})$/);
  const exportMatch = req.url?.match(/^\/api\/exports\/([a-f0-9-]{36})$/);
  if (req.method === 'POST' && req.url === '/api/media/import') {
    try {
      const id = randomUUID(); const file = path.join(uploadRoot, `${id}.media`);
      const bb = Busboy({headers:req.headers, limits:{files:1, fileSize:1024*1024*1024}});
      let filename = 'video'; let fileError = null; const writes=[];
      bb.on('file', (_field, stream, info) => {
        filename = path.basename(info.filename || 'video').slice(0,180);
        const ext=path.extname(filename).toLowerCase();
        const mimeByExt={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg'};
        assetMime.set(id, mimeByExt[ext] || info.mimeType || 'application/octet-stream');
        stream.on('limit', () => { fileError = new Error('Video exceeds the 1 GB upload limit.'); });
        writes.push(pipeline(stream, createWriteStream(file)).catch(error => { fileError = error; }));
      });
      await new Promise((resolve,reject) => { bb.on('close',resolve); bb.on('error',reject); req.pipe(bb); });
      await Promise.all(writes);
      if (fileError) { await rm(file,{force:true}); throw fileError; }
      const metadata = await probe(file);
      sendJson(res, 201, {id, filename, ...metadata}); return;
    } catch(error) { sendJson(res, 400, {error:error.message || 'Unable to import video.'}); return; }
  }
  if (req.method === 'GET' && mediaMatch) {
    try {
      const file=assetPath(mediaMatch[1]); const info=await stat(file); const range=req.headers.range;
      res.setHeader('Content-Type',assetMime.get(mediaMatch[1]) || 'application/octet-stream'); res.setHeader('Accept-Ranges','bytes'); res.setHeader('Access-Control-Expose-Headers','Content-Range, Accept-Ranges, Content-Length');
      if (range) { const m=range.match(/bytes=(\d+)-(\d*)/); if (!m) { res.writeHead(416).end(); return; } const start=Number(m[1]), end=Math.min(Number(m[2]||info.size-1),info.size-1); if(start>end||start>=info.size){res.writeHead(416).end();return;} res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1}); createReadStream(file,{start,end}).pipe(res); }
      else { res.writeHead(200,{'Content-Length':info.size}); createReadStream(file).pipe(res); }
      return;
    } catch { sendJson(res,404,{error:'Media not found.'}); return; }
  }
  if (req.method === 'POST' && req.url === '/api/media/analyze') {
    try {
      const input=await readJson(req); const file=assetPath(input.assetId); const meta=await probe(file);
      const analysis=await ffmpeg(['-i',file,'-vf','blackdetect=d=0.5:pix_th=0.10','-af','silencedetect=noise=-38dB:d=0.6','-f','null','-'],{maxBuffer:16*1024*1024});
      const log=analysis.stderr||'';
      const silences=[...log.matchAll(/silence_start: ([0-9.]+).*?silence_end: ([0-9.]+)/gs)].map(m=>({start:Number(m[1]),end:Number(m[2])}));
      const black=[...log.matchAll(/black_start: ([0-9.]+).*?black_end: ([0-9.]+)/gs)].map(m=>({start:Number(m[1]),end:Number(m[2])}));
      sendJson(res,200,{metadata:meta,silences,blackFrames:black,notes:['Detection is signal-based; review proposed removals before applying.']}); return;
    } catch(error) { sendJson(res,400,{error:error.message}); return; }
  }
  if (req.method === 'POST' && req.url === '/api/captions') {
    if (!process.env.OPENAI_API_KEY) { sendJson(res,503,{error:'OPENAI_API_KEY is not configured on the backend.'}); return; }
    try {
      const input=await readJson(req); const source=assetPath(input.assetId); const metadata=await probe(source);
      if(!metadata.audio) throw new Error('This media has no audio track to caption.');
      const segments=await transcribeMedia(source);
      sendJson(res,200,{duration:metadata.duration,segments}); return;
    } catch(error) { sendJson(res,500,{error:error.message||'Caption generation failed.'}); return; }
  }
  if (req.method === 'POST' && req.url === '/api/render') {
    let workDir;
    try {
      const input=await readJson(req); const clips=Array.isArray(input.clips)?input.clips:[];
      if(!clips.length||clips.length>100) throw new Error('Add between 1 and 100 clips to the timeline.');
      const longSide=input.resolution==='4K'?3840:input.resolution==='720p'?1280:1920; const aspect=input.aspect==='9:16'?'9:16':input.aspect==='1:1'?'1:1':'16:9'; const width=aspect==='9:16'?Math.round(longSide*9/16):longSide; const height=aspect==='16:9'?Math.round(longSide*9/16):longSide;
      workDir=await mkdtemp(path.join(tmpdir(),'cutstudio-render-')); const parts=[]; const renderTimeMap=[]; let sourceTimelineOffset=0, outputTimelineOffset=0;
      for(let i=0;i<clips.length;i++) {
        const clip=clips[i], source=assetPath(clip.assetId), meta=await probe(source), start=Math.max(0,Number(clip.start)||0), end=Math.min(meta.duration,Number(clip.end)||meta.duration);
        if(end<=start) throw new Error(`Clip ${i+1} has an invalid trim range.`);
        let ranges=[[start,end]];
        if(clip.removeSilences && meta.audio) {
          const scan=await ffmpeg(['-i',source,'-vn','-af','silencedetect=noise=-38dB:d=0.6','-f','null','-'],{maxBuffer:16*1024*1024});
          const gaps=[...(scan.stderr||'').matchAll(/silence_start: ([0-9.]+).*?silence_end: ([0-9.]+)/gs)].map(m=>({start:Number(m[1]),end:Number(m[2])}));
          const kept=[]; let cursor=start; const pad=0.12;
          for(const gap of gaps){const cutStart=Math.max(start,gap.start-pad),cutEnd=Math.min(end,gap.end+pad); if(cutStart>cursor+0.25) kept.push([cursor,cutStart]); cursor=Math.max(cursor,cutEnd);}
          if(end>cursor+0.25) kept.push([cursor,end]); if(kept.length) ranges=kept;
        }
        const brightness=Math.max(-0.5,Math.min(0.5,(Number(clip.exposure??0.5)-0.5)*0.8)), contrast=Math.max(0.5,Math.min(2,Number(clip.contrast??0.64)*2)), saturation=Math.max(0,Math.min(2,Number(clip.saturation??0.71)*2));
        for(let r=0;r<ranges.length;r++) {
          const [rangeStart,rangeEnd]=ranges[r], duration=rangeEnd-rangeStart, out=path.join(workDir,`part-${i}-${r}.mp4`);
          renderTimeMap.push({sourceStart:sourceTimelineOffset+(rangeStart-start),sourceEnd:sourceTimelineOffset+(rangeEnd-start),outputStart:outputTimelineOffset}); outputTimelineOffset+=duration;
          const args=['-ss',String(rangeStart),'-i',source]; if(!meta.audio) args.push('-f','lavfi','-t',String(duration),'-i','anullsrc=channel_layout=stereo:sample_rate=48000');
          args.push('-t',String(duration),'-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation},format=yuv420p`,'-map','0:v:0','-map',meta.audio?'0:a:0':'1:a:0');
          if(meta.audio) args.push('-af','highpass=f=70,lowpass=f=16000,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11');
          args.push('-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',out); await ffmpeg(args); parts.push(out);
        }
        sourceTimelineOffset+=end-start;
      }
      const list=path.join(workDir,'concat.txt'); await writeFile(list,parts.map(f=>`file '${path.basename(f)}'`).join('\n'));
      const joined=path.join(workDir,'joined.mp4'); await ffmpeg(['-f','concat','-safe','0','-i',list,'-c','copy',joined],{cwd:workDir});
      let audioMixed=joined;
      if(input.musicAssetId){const music=assetPath(input.musicAssetId),mix=path.join(workDir,'music-mix.mp4'),volume=Math.max(0,Math.min(1,Number(input.musicVolume??0.18))),duration=(await probe(joined)).duration,fadeStart=Math.max(0,duration-2);await probe(music);await ffmpeg(['-i',joined,'-stream_loop','-1','-i',music,'-filter_complex',`[1:a:0]volume=${volume},afade=t=in:st=0:d=0.2,afade=t=out:st=${fadeStart}:d=2[m];[0:a:0][m]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[a]`,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',mix]);audioMixed=mix;}
      const captions=Array.isArray(input.captions)?input.captions.filter(s=>String(s.text||'').trim()):[]; const mappedCaptions=captions.flatMap(c=>renderTimeMap.map(m=>{const start=Math.max(Number(c.start)||0,m.sourceStart),end=Math.min(Number(c.end)||0,m.sourceEnd);return end>start?{...c,start:m.outputStart+(start-m.sourceStart),end:m.outputStart+(end-m.sourceStart)}:null;}).filter(Boolean)); let finalFile=audioMixed;
      if(mappedCaptions.length) {
        const srt=path.join(workDir,'captions.srt'); const time=n=>{const ms=Math.round(Math.max(0,n)*1000),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),x=ms%1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(x).padStart(3,'0')}`};
        await writeFile(srt,mappedCaptions.map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.end)}\n${String(c.text).replace(/[<>]/g,'').slice(0,500)}\n`).join('\n'));
        finalFile=path.join(workDir,'captioned.mp4');
        if(input.captionMode==='burned') await ffmpeg(['-i',audioMixed,'-vf',`subtitles=${path.basename(srt)}:force_style='FontSize=24,Outline=2,MarginV=48'`,'-c:v','libx264','-preset','veryfast','-crf','20','-c:a','copy','-movflags','+faststart',finalFile],{cwd:workDir});
        else await ffmpeg(['-i',audioMixed,'-i',srt,'-map','0:v:0','-map','0:a:0?','-map','1:0','-c:v','copy','-c:a','copy','-c:s','mov_text','-movflags','+faststart',finalFile]);
      }
      const id=randomUUID(), destination=path.join(exportRoot,`${id}.mp4`); await pipeline(createReadStream(finalFile),createWriteStream(destination));
      const metadata=await probe(destination); const qc=[];
      if(!metadata.audio) qc.push({severity:'warning',message:'No audio stream is present.'});
      if(metadata.width!==width||metadata.height!==height) qc.push({severity:'error',message:'Output dimensions do not match the selected export profile.'});
      if(metadata.duration<1) qc.push({severity:'error',message:'Output is unexpectedly short.'});
      if(metadata.videoCodec!=='h264') qc.push({severity:'warning',message:`Video codec is ${metadata.videoCodec}, expected H.264.`});
      if(Math.abs(metadata.fps-30)>0.1) qc.push({severity:'warning',message:`Output frame rate is ${metadata.fps.toFixed(3)} fps; expected 30 fps.`});
      if(metadata.pixelFormat!=='yuv420p') qc.push({severity:'warning',message:`Output pixel format is ${metadata.pixelFormat}; yuv420p is the compatibility target.`});
      if(metadata.audio&&(metadata.audioSampleRate!==48000||metadata.audioChannels!==2)) qc.push({severity:'warning',message:`Audio is ${metadata.audioSampleRate} Hz / ${metadata.audioChannels} channel(s); expected 48000 Hz stereo.`});
      if(metadata.videoDuration&&metadata.audioDuration&&Math.abs(metadata.videoDuration-metadata.audioDuration)>0.25) qc.push({severity:'warning',message:`Audio/video stream duration differs by ${(metadata.videoDuration-metadata.audioDuration).toFixed(2)}s.`});
      const scan=await ffmpeg(['-i',destination,'-vf','blackdetect=d=2:pix_th=0.10','-af','silencedetect=noise=-45dB:d=3','-f','null','-'],{maxBuffer:16*1024*1024}); const log=scan.stderr||'';
      const black=[...log.matchAll(/black_start: ([0-9.]+).*?black_end: ([0-9.]+)/gs)].map(m=>({start:Number(m[1]),end:Number(m[2])}));
      const silence=[...log.matchAll(/silence_start: ([0-9.]+).*?silence_end: ([0-9.]+)/gs)].map(m=>({start:Number(m[1]),end:Number(m[2])}));
      if(black.length) qc.push({severity:'warning',message:`Detected ${black.length} extended black interval(s).`, intervals:black});
      if(silence.length) qc.push({severity:'info',message:`Detected ${silence.length} extended silent interval(s).`, intervals:silence});
      sendJson(res,201,{id,url:`/api/exports/${id}`,metadata,qc}); return;
    } catch(error) { sendJson(res,400,{error:error.message||'Video export failed. Check that FFmpeg and FFprobe are installed.'}); return; }
    finally { if(workDir) await rm(workDir,{recursive:true,force:true}); }
  }
  if(req.method==='GET'&&exportMatch){
    try{const file=path.join(exportRoot,`${exportMatch[1]}.mp4`);const info=await stat(file);res.writeHead(200,{'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="cut-studio-export.mp4"','Content-Length':info.size,'Access-Control-Expose-Headers':'Content-Length'});createReadStream(file).pipe(res);return;}catch{sendJson(res,404,{error:'Export not found.'});return;}
  }
  if (req.method !== 'POST' || req.url !== '/api/edit-plan') {
    sendJson(res,404,{error:'Not found'}); return;
  }
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error('Request is too large.'); }
    const input = JSON.parse(raw);
    const useLocal = !process.env.OPENAI_API_KEY;
    const localToken = process.env.LM_STUDIO_API_TOKEN || process.env.LM_API_TOKEN;
    const localVision = useLocal && Boolean(localToken);
    const prompt = String(input.prompt || '').slice(0, 4000);
    const clips = Array.isArray(input.clips) ? input.clips.slice(0, 20).map(c => ({assetId:String(c.assetId||''),name:String(c.name||'Clip').slice(0,180),durationSeconds:Number(c.durationSeconds)||0,trimStart:Number(c.trimStart)||0,trimEnd:Number(c.trimEnd)||0})) : [];
    if(!clips.length) throw new Error('Add media to the timeline before asking AI to edit.');
    const wantsTranscript=Boolean(input.includeTranscript)||/dialogue|speech|word|quote|caption|subtitle|transcript/i.test(prompt);
    const evidence=[];
    for(let i=0;i<clips.length;i++) {
      const clip=clips[i]; if(!/^[a-f0-9-]{36}$/.test(clip.assetId)) throw new Error(`Clip ${i+1} has no valid local media asset.`);
      const source=assetPath(clip.assetId), metadata=await probe(source); clip.metadata=metadata;
      const start=Math.max(0,clip.trimStart), end=Math.min(metadata.duration,clip.trimEnd||metadata.duration);
      const frames=(!useLocal||localVision)&&metadata.width?await sampleFrames(source,start,end,2):[];
      const transcript=!useLocal&&wantsTranscript&&metadata.audio?(await transcribeMedia(source)).filter(s=>s.end>start&&s.start<end).slice(0,100):[];
      evidence.push({index:i,name:clip.name,trimStart:start,trimEnd:end,metadata,transcript,frames});
    }
    if(useLocal) {
      if(localVision) {
        const localContent=[{type:'text',text:`User request: ${prompt}. You may inspect only the labeled sampled frames and media metadata below, not every moment. Do not invent events. Return a concise plan and conservative, reviewable cut decisions in timeline order. Preserve uncertain shots. Captions enabled: ${Boolean(input.captionsEnabled)}.`}];
        for(const item of evidence){localContent.push({type:'text',text:`CLIP ${item.index} ${item.name}, trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)} seconds. Technical metadata: ${JSON.stringify(item.metadata)}`});for(const frame of item.frames){localContent.push({type:'text',text:`Clip ${item.index} sample at ${frame.time.toFixed(2)} seconds`});localContent.push({type:'image_url',image_url:{url:`data:image/jpeg;base64,${frame.data}`}});}}
        const base=(process.env.LM_STUDIO_BASE_URL||'http://127.0.0.1:1234/v1').replace(/\/$/,'');
        const localResponse=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${localToken}`,'Content-Type':'application/json'},body:JSON.stringify({model:localModel,messages:[{role:'system',content:'You are Cut Studio, a careful video editor. Never claim an edit was executed.'},{role:'user',content:localContent}],temperature:0.2,max_tokens:1800,response_format:{type:'json_schema',json_schema:{name:'cut_studio_edit_plan',strict:true,schema}}})});
        const payload=await localResponse.json();
        if(!localResponse.ok) throw new Error(payload?.error?.message||`LM Studio vision request failed (${localResponse.status}).`);
        const text=payload.choices?.[0]?.message?.content;
        if(!text) throw new Error(`Local vision model ${localModel} returned no edit plan.`);
        const result=JSON.parse(text); result.engine='local'; result.model=localModel;
        result.editDecisions=(result.editDecisions||[]).filter(d=>Number.isInteger(d.clipIndex)&&d.clipIndex>=0&&d.clipIndex<clips.length).map(d=>{const clip=clips[d.clipIndex],lo=Math.max(0,clip.trimStart),hi=Math.min(clip.durationSeconds,clip.trimEnd||clip.durationSeconds);let a=Math.max(lo,Math.min(hi,Number(d.inPoint))),b=Math.max(lo,Math.min(hi,Number(d.outPoint)));if(b-a<0.3){a=lo;b=hi;}return {...d,position:Math.max(0,Math.min(clips.length-1,Number(d.position)||0)),inPoint:a,outPoint:b};});
        res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(result)); return;
      }
      const clipSummary=evidence.map(c=>`${c.index}: ${c.name}, ${c.trimEnd-c.trimStart}s, ${c.metadata.width||'audio'}x${c.metadata.height||''}, ${c.metadata.fps||0}fps`).join('; ');
      const localPrompt=`For this request: "${prompt.slice(0,500)}". Give one practical edit action in under 20 words. You cannot see or hear the clips. Do not invent content or repeat technical metadata. If content is unknown, tell the editor what to review before choosing a cut. Clip facts: ${clipSummary}`;
      const local = await runLocalChat(localPrompt);
      const cleaned=(local.stdout||'').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\u001b\][^\u0007]*(?:\u0007|$)/g,'').trim();
      if(!cleaned) throw new Error(`Local model ${localModel} returned an empty recommendation.`);
      const summary=cleaned.slice(-1500).trim();
      const result={title:'Local AI edit plan',summary,steps:[{order:1,action:'Editing recommendation',detail:summary},{order:2,action:'Review and refine',detail:'Preview the full clips, then adjust trims and sequence in the timeline. This local text model did not inspect frames or audio.'}],editDecisions:[],engine:'local',model:localModel};
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(result)); return;
    }
    const content=[{type:'input_text',text:`User request: ${prompt}\nCaptions enabled: ${Boolean(input.captionsEnabled)}. You can inspect only supplied sampled frames and transcript excerpts, not every moment. Samples are approximate. Never invent unseen actions or claim edits were executed. Return cut proposals only when evidence supports them; preserve uncertain clips. Keep in/out within each supplied trim range and at least 0.3 seconds for kept clips. Include a concise practical process and a reason for every proposed cut.`}];
    for(const item of evidence){content.push({type:'input_text',text:`CLIP ${item.index} (${item.name}), trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)}s; metadata ${JSON.stringify(item.metadata)}; transcript ${JSON.stringify(item.transcript)}`});for(const frame of item.frames){content.push({type:'input_text',text:`Sample from clip ${item.index} at source ${frame.time.toFixed(2)}s`});content.push({type:'input_image',image_url:`data:image/jpeg;base64,${frame.data}`,detail:'low'});}}
    const ai = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: {'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model, input:[{role:'user',content}], text: {format: {type: 'json_schema', name: 'cut_studio_edit_plan', strict: true, schema}}})
    });
    const payload = await ai.json();
    if (!ai.ok) {
      const message = payload?.error?.message || `OpenAI request failed (${ai.status}).`;
      res.writeHead(502, {'Content-Type': 'application/json'}).end(JSON.stringify({error: message})); return;
    }
    const text = payload.output_text || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    if (!text) throw new Error('AI returned no edit plan.');
    const result=JSON.parse(text);
    result.editDecisions=(result.editDecisions||[]).filter(d=>Number.isInteger(d.clipIndex)&&d.clipIndex>=0&&d.clipIndex<clips.length).map(d=>{const clip=clips[d.clipIndex],lo=Math.max(0,clip.trimStart),hi=Math.min(clip.durationSeconds,clip.trimEnd||clip.durationSeconds);let a=Math.max(lo,Math.min(hi,Number(d.inPoint))),b=Math.max(lo,Math.min(hi,Number(d.outPoint)));if(b-a<0.3){a=lo;b=hi;}return {...d,position:Math.max(0,Math.min(clips.length-1,Number(d.position)||0)),inPoint:a,outPoint:b};});
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify({error: error.message || 'Unable to create an edit plan.'}));
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Cut Studio media and AI backend listening on ${process.env.HOST || '127.0.0.1'}:${port}`));
