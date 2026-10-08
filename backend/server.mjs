import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
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
  if (!video) throw new Error('No video stream was found.');
  return { duration: Number(value.format.duration || video.duration || 0), width: video.width, height: video.height, fps: (video.avg_frame_rate || '0/1').split('/').map(Number).reduce((a,b) => b ? a/b : 0), videoCodec: video.codec_name, audio: value.streams.some(s => s.codec_type === 'audio'), audioCodec: value.streams.find(s => s.codec_type === 'audio')?.codec_name || null, sizeBytes: Number(value.format.size || 0) };
}
async function ffmpeg(args, options = {}) {
  try { return await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-y',...args], { maxBuffer: 12 * 1024 * 1024, ...options }); }
  catch (error) { throw new Error((error.stderr || error.message || 'FFmpeg failed').slice(-3000)); }
}
function assetPath(id) { if (!/^[a-f0-9-]{36}$/.test(String(id))) throw new Error('Invalid media id.'); return path.join(uploadRoot, `${id}.media`); }
function sendJson(res, status, value) { res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(value)); }
async function readJson(req, limit=200_000) { let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > limit) throw new Error('Request is too large.'); } return JSON.parse(raw); }

const assetMime = new Map();
const schema = {
  type: 'object', additionalProperties: false, required: ['title', 'summary', 'steps'],
  properties: {
    title: { type: 'string' }, summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['order', 'action', 'detail'], properties: {
        order: { type: 'integer' }, action: { type: 'string' }, detail: { type: 'string' }
      } }
    }
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
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ok: true, configured: Boolean(process.env.OPENAI_API_KEY)})); return;
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
        const mimeByExt={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo'};
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
    let audioDir;
    try {
      const input=await readJson(req); const source=assetPath(input.assetId); const metadata=await probe(source);
      audioDir=await mkdtemp(path.join(tmpdir(),'cutstudio-caption-'));
      await ffmpeg(['-i',source,'-vn','-ac','1','-ar','16000','-b:a','48k','-f','segment','-segment_time','600','-reset_timestamps','1',path.join(audioDir,'chunk-%03d.mp3')]);
      const chunks=(await readdir(audioDir)).filter(name=>name.endsWith('.mp3')).sort(); const segments=[];
      for(let index=0;index<chunks.length;index++) {
        const bytes=await readFile(path.join(audioDir,chunks[index])); const form=new FormData();
        form.append('file',new Blob([bytes],{type:'audio/mpeg'}),chunks[index]); form.append('model',process.env.TRANSCRIPTION_MODEL||'whisper-1'); form.append('response_format','verbose_json'); form.append('timestamp_granularities[]','segment');
        const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form}); const payload=await response.json();
        if(!response.ok) throw new Error(payload?.error?.message||'Transcription failed.');
        for(const segment of payload.segments||[]) segments.push({start:Number(segment.start)+index*600,end:Number(segment.end)+index*600,text:String(segment.text||'').trim()});
      }
      sendJson(res,200,{duration:metadata.duration,segments}); return;
    } catch(error) { sendJson(res,500,{error:error.message||'Caption generation failed.'}); return; }
    finally { if(audioDir) await rm(audioDir,{recursive:true,force:true}); }
  }
  if (req.method === 'POST' && req.url === '/api/render') {
    let workDir;
    try {
      const input=await readJson(req); const clips=Array.isArray(input.clips)?input.clips:[];
      if(!clips.length||clips.length>100) throw new Error('Add between 1 and 100 clips to the timeline.');
      const width=input.resolution==='4K'?3840:input.resolution==='720p'?1280:1920; const height=input.resolution==='4K'?2160:input.resolution==='720p'?720:1080;
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
      const captions=Array.isArray(input.captions)?input.captions.filter(s=>String(s.text||'').trim()):[]; const mappedCaptions=captions.flatMap(c=>renderTimeMap.map(m=>{const start=Math.max(Number(c.start)||0,m.sourceStart),end=Math.min(Number(c.end)||0,m.sourceEnd);return end>start?{...c,start:m.outputStart+(start-m.sourceStart),end:m.outputStart+(end-m.sourceStart)}:null;}).filter(Boolean)); let finalFile=joined;
      if(mappedCaptions.length) {
        const srt=path.join(workDir,'captions.srt'); const time=n=>{const ms=Math.round(Math.max(0,n)*1000),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),x=ms%1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(x).padStart(3,'0')}`};
        await writeFile(srt,mappedCaptions.map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.end)}\n${String(c.text).replace(/[<>]/g,'').slice(0,500)}\n`).join('\n'));
        finalFile=path.join(workDir,'captioned.mp4'); await ffmpeg(['-i',joined,'-i',srt,'-map','0:v:0','-map','0:a:0?','-map','1:0','-c:v','copy','-c:a','copy','-c:s','mov_text','-movflags','+faststart',finalFile]);
      }
      const id=randomUUID(), destination=path.join(exportRoot,`${id}.mp4`); await pipeline(createReadStream(finalFile),createWriteStream(destination));
      const metadata=await probe(destination); const qc=[];
      if(!metadata.audio) qc.push({severity:'warning',message:'No audio stream is present.'});
      if(metadata.width!==width||metadata.height!==height) qc.push({severity:'error',message:'Output dimensions do not match the selected export profile.'});
      if(metadata.duration<1) qc.push({severity:'error',message:'Output is unexpectedly short.'});
      if(metadata.videoCodec!=='h264') qc.push({severity:'warning',message:`Video codec is ${metadata.videoCodec}, expected H.264.`});
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
  if (!process.env.OPENAI_API_KEY) {
    res.writeHead(503, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'OPENAI_API_KEY is not configured on the backend.'})); return;
  }
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error('Request is too large.'); }
    const input = JSON.parse(raw);
    const prompt = String(input.prompt || '').slice(0, 4000);
    const clips = Array.isArray(input.clips) ? input.clips.slice(0, 100).map(c => ({name: String(c.name || 'Clip').slice(0, 180), sizeBytes: Number(c.sizeBytes) || 0, durationSeconds: Number(c.durationSeconds)||0, trimStart: Number(c.trimStart)||0, trimEnd: Number(c.trimEnd)||0})) : [];
    const instructions = `You are Cut Studio, an assistant that plans practical non-destructive video edits. Return concise actionable steps in timeline order, covering ingest and story assembly, picture, sound, captions, color, quality control, and delivery when relevant. Refer to clips by filename when useful. Do not claim to have inspected video or audio: you only receive filenames and sizes. Do not claim edits were executed. Include sensible stages such as story/pacing, trims, captions, audio, color, and quality control only when relevant. User request: ${prompt}. Captions enabled: ${Boolean(input.captionsEnabled)}. Clip metadata: ${JSON.stringify(clips)}`;
    const ai = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: {'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model, input: instructions, text: {format: {type: 'json_schema', name: 'cut_studio_edit_plan', strict: true, schema}}})
    });
    const payload = await ai.json();
    if (!ai.ok) {
      const message = payload?.error?.message || `OpenAI request failed (${ai.status}).`;
      res.writeHead(502, {'Content-Type': 'application/json'}).end(JSON.stringify({error: message})); return;
    }
    const text = payload.output_text || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    if (!text) throw new Error('AI returned no edit plan.');
    res.writeHead(200, {'Content-Type': 'application/json'}).end(text);
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify({error: error.message || 'Unable to create an edit plan.'}));
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Cut Studio media and AI backend listening on ${process.env.HOST || '127.0.0.1'}:${port}`));
