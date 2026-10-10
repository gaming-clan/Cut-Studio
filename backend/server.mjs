import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const providerDetails = {
  openai: {label:'OpenAI', model, captions:true},
  anthropic: {label:'Anthropic', model:'claude-haiku-4-5-20251001', captions:false},
  gemini: {label:'Google Gemini', model:'gemini-3.8-flash', captions:false},
  groq: {label:'Groq', model:'qwen/qwen3.6-27b', captions:true},
  nvidia: {label:'NVIDIA NIM', model:'deepseek-ai/deepseek-v4.1-flash', captions:false},
  openrouter: {label:'OpenRouter', model:'openai/gpt-4.1-mini', captions:false},
  xai: {label:'xAI', model:'grok-4.3', captions:false},
};
const byokModels = [];
let aiSelection = {mode:'auto',modelId:'auto'};
let localModelsCache = {at:0,models:[]};
function detectProvider(key) {
  if (/^sk-ant-/.test(key)) return 'anthropic';
  if (/^sk-or-v1-/.test(key)) return 'openrouter';
  if (/^gsk_/.test(key)) return 'groq';
  if (/^nvapi-/.test(key)) return 'nvidia';
  if (/^AIza[\w-]{20,}$/.test(key)) return 'gemini';
  if (/^xai-/.test(key)) return 'xai';
  if (/^sk-(?:proj-|svcacct-|admin-|)/.test(key)) return 'openai';
  return null;
}
function environmentModel() {
  return process.env.OPENAI_API_KEY ? {id:'env-openai',kind:'byok',provider:'openai',key:process.env.OPENAI_API_KEY,model,label:'OpenAI (environment key)',name:'OpenAI (environment key)',supportsCaptions:true,vision:true} : null;
}
function publicModel(item) {
  const {key,...safe}=item;
  return safe;
}
function publicByokModels() {
  return [...byokModels,...(environmentModel()?[environmentModel()]:[])].map(publicModel);
}
async function discoverLocalModels() {
  if(Date.now()-localModelsCache.at<20_000) return localModelsCache.models;
  try {
    const {stdout}=await execFileAsync(localCli,['ls','--llm','--json'],{timeout:15_000,maxBuffer:4*1024*1024,windowsHide:true});
    const start=stdout.indexOf('[');
    if(start<0) throw new Error('LM Studio model list was not JSON.');
    const entries=JSON.parse(stdout.slice(start)).filter(item=>item.type==='llm'&&item.modelKey);
    localModelsCache={at:Date.now(),models:entries.map(item=>({id:`local:${encodeURIComponent(item.modelKey)}`,kind:'local',provider:'lmstudio',model:item.modelKey,name:item.displayName||item.modelKey,label:item.displayName||item.modelKey,vision:Boolean(item.vision),supportsCaptions:false,paramsString:item.paramsString||'',maxContextLength:item.maxContextLength||0}))};
  } catch {
    localModelsCache={at:Date.now(),models:[{id:`local:${encodeURIComponent(localModel)}`,kind:'local',provider:'lmstudio',model:localModel,name:localModel,label:localModel,vision:false,supportsCaptions:false,paramsString:'',maxContextLength:0}]};
  }
  return localModelsCache.models;
}
async function modelCatalog() {
  const local=await discoverLocalModels();
  return [{id:'auto',kind:'auto',provider:null,model:null,name:'Auto · choose per task',label:'Auto · choose per task',vision:true,supportsCaptions:true},...local,...publicByokModels()];
}
function activeProvider(modelId=null) {
  if(aiSelection.mode==='local') return null;
  const selectedId=modelId||aiSelection.modelId;
  if(selectedId&&selectedId!=='auto') {
    const selected=byokModels.find(item=>item.id===selectedId);
    if(selected) return selected;
    if(selectedId==='env-openai') return environmentModel();
  }
  if(aiSelection.mode==='byok') return byokModels[0]||environmentModel();
  return environmentModel();
}
function transcriptionProvider() {
  if(aiSelection.mode==='local') return null;
  if(aiSelection.mode==='byok') {
    const selected=activeProvider();
    return selected&&providerDetails[selected.provider]?.captions?selected:null;
  }
  return [...byokModels,...(environmentModel()?[environmentModel()]:[])].find(item=>providerDetails[item.provider]?.captions)||null;
}
function providerStatus() {
  const config=activeProvider();
  return config ? {configured:true,provider:config.provider,label:config.label||providerDetails[config.provider].label,supportsCaptions:providerDetails[config.provider].captions} : {configured:false,provider:null,label:'Local LM Studio',supportsCaptions:false};
}
function geminiSchema(source) {
  const types={object:'OBJECT',array:'ARRAY',string:'STRING',number:'NUMBER',integer:'INTEGER',boolean:'BOOLEAN'};
  const target={type:types[source.type]||'STRING'};
  if(source.properties) target.properties=Object.fromEntries(Object.entries(source.properties).map(([key,value])=>[key,geminiSchema(value)]));
  if(source.required) target.required=source.required;
  if(source.items) target.items=geminiSchema(source.items);
  if(source.enum) target.enum=source.enum;
  if(source.description) target.description=source.description;
  return target;
}
function localSizeScore(item) {
  const size=parseFloat(String(item.paramsString||'').replace(/[^0-9.]/g,''));
  return Number.isFinite(size)?size:0;
}
function providerQualityScore(item) {
  const rank={openai:8,anthropic:7,gemini:7,nvidia:7,xai:6,groq:5,openrouter:5};
  return rank[item.provider]||0;
}
async function resolveAiModel(input,prompt) {
  const mode=['auto','local','byok'].includes(input.aiMode)?input.aiMode:aiSelection.mode;
  const selectedId=String(input.modelId||aiSelection.modelId||'auto');
  const models=await modelCatalog();
  const local=models.filter(item=>item.kind==='local');
  const remote=models.filter(item=>item.kind==='byok');
  if(mode==='local') {
    const selected=local.find(item=>item.id===selectedId)||local.find(item=>item.model===localModel)||local[0];
    if(!selected) throw new Error('No local language models were found. Start LM Studio and refresh the model list.');
    return {...selected,key:null,reason:`Local mode selected ${selected.name}.`};
  }
  if(mode==='byok') {
    const selected=remote.find(item=>item.id===selectedId)||remote[0];
    if(!selected) throw new Error('BYOK mode has no configured models. Add a provider key and model in AI Model Settings.');
    const secret=byokModels.find(item=>item.id===selected.id)||environmentModel();
    return {...selected,...secret,reason:`BYOK mode selected ${selected.name}.`};
  }
  const needsTranscript=/dialogue|speech|spoken|quote|exact words|transcript|transcribe|what .* say|captions/i.test(prompt);
  const transcriptModel=remote.filter(item=>item.supportsCaptions).sort((a,b)=>providerQualityScore(b)-providerQualityScore(a))[0];
  if(needsTranscript&&transcriptModel) {
    const secret=byokModels.find(item=>item.id===transcriptModel.id)||environmentModel();
    return {...transcriptModel,...secret,reason:`The request depends on spoken words, so Auto selected ${transcriptModel.name}, which can also transcribe audio.`};
  }
  const localToken=process.env.LM_STUDIO_API_TOKEN||process.env.LM_API_TOKEN;
  const localVision=localToken?local.filter(item=>item.vision).sort((a,b)=>localSizeScore(b)-localSizeScore(a))[0]:null;
  if(localVision) return {...localVision,key:null,reason:`Auto selected the largest available local vision model, ${localVision.name}, to inspect the footage without sending it to a cloud provider.`};
  const remoteVision=remote.filter(item=>item.vision).sort((a,b)=>providerQualityScore(b)-providerQualityScore(a))[0];
  if(remoteVision) {
    const secret=byokModels.find(item=>item.id===remoteVision.id)||environmentModel();
    return {...remoteVision,...secret,reason:`Auto selected ${remoteVision.name}, the strongest configured vision-capable BYOK model, for shot analysis.`};
  }
  const localText=local.sort((a,b)=>localSizeScore(b)-localSizeScore(a))[0];
  if(localText) return {...localText,key:null,reason:`No vision-capable model is ready, so Auto chose ${localText.name} for a text-only editing recommendation.`};
  throw new Error('No local or BYOK AI models are available. Configure LM Studio or add a provider key.');
}
const dataRoot = path.resolve(process.env.CUT_STUDIO_DATA || 'data');
const uploadRoot = path.join(dataRoot, 'uploads');
const exportRoot = path.join(dataRoot, 'exports');
const autosavePath = path.join(dataRoot, 'autosave.cutstudio.json');
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
function runLocalChat(prompt, modelName=localModel, systemPrompt='Return a concise, evidence-based response.') {
  return new Promise((resolve, reject) => {
    const child = spawn(localCli, ['chat', modelName, '--reasoning', 'off', '-p', prompt, '-s', systemPrompt, '--ttl', '3600'], { windowsHide: true });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error(`Local model ${modelName} timed out.`)); }, 3 * 60 * 1000);
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

async function transcribeMedia(source, config=transcriptionProvider()) {
  if(!config||!providerDetails[config.provider].captions) throw new Error('Automatic captions are available with OpenAI or Groq keys.');
  const audioDir = await mkdtemp(path.join(tmpdir(), 'cutstudio-caption-'));
  try {
    await ffmpeg(['-i', source, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', path.join(audioDir, 'chunk-%03d.mp3')]);
    const chunks = (await readdir(audioDir)).filter(name => name.endsWith('.mp3')).sort();
    const segments = [];
    for (let index = 0; index < chunks.length; index++) {
      const bytes = await readFile(path.join(audioDir, chunks[index]));
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), chunks[index]);
      form.append('model', config.provider==='groq'?'whisper-large-v3-turbo':(process.env.TRANSCRIPTION_MODEL||'whisper-1'));
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      const transcriptionUrl=config.provider==='groq'?'https://api.groq.com/openai/v1/audio/transcriptions':'https://api.openai.com/v1/audio/transcriptions';
      const response = await fetch(transcriptionUrl, {
        method: 'POST', headers: { Authorization: `Bearer ${config.key}` }, body: form,
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
const mimeByExtension = {
  '.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime',
  '.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4',
  '.aac':'audio/aac','.ogg':'audio/ogg',
};
for (const name of await readdir(uploadRoot)) {
  if (!name.endsWith('.meta.json')) continue;
  try {
    const metadata = JSON.parse(await readFile(path.join(uploadRoot, name), 'utf8'));
    if (/^[a-f0-9-]{36}$/.test(metadata.id) && typeof metadata.mimeType === 'string') assetMime.set(metadata.id, metadata.mimeType);
  } catch { /* Ignore incomplete metadata; media validation will still detect the asset. */ }
}
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ok: true, ...providerStatus(), localModel})); return;
  }
  if (req.method === 'GET' && req.url === '/api/project/autosave') {
    try {
      const contents = await readFile(autosavePath, 'utf8');
      sendJson(res, 200, {found:true, project:JSON.parse(contents)}); return;
    } catch (error) {
      if (error.code === 'ENOENT') { sendJson(res, 200, {found:false}); return; }
      sendJson(res, 500, {error:'The autosaved project could not be read.'}); return;
    }
  }
  if (req.method === 'PUT' && req.url === '/api/project/autosave') {
    try {
      const project = await readJson(req, 50_000_000);
      if (project?.format !== 'cutstudio' || project?.version !== 1 || !Array.isArray(project.media) || !Array.isArray(project.timelineAssetIds)) {
        sendJson(res, 422, {error:'Unsupported or invalid Cut Studio project data.'}); return;
      }
      const temporary = `${autosavePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(project), 'utf8');
      await rename(temporary, autosavePath);
      sendJson(res, 200, {ok:true}); return;
    } catch (error) { sendJson(res, 400, {error:error.message || 'Could not autosave the project.'}); return; }
  }
  if (req.method === 'POST' && req.url === '/api/media/validate') {
    try {
      const input = await readJson(req, 100_000), ids = Array.isArray(input.assetIds) ? input.assetIds.slice(0, 500) : [];
      const names = new Map((Array.isArray(input.assets) ? input.assets : []).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').map(item => [item.id, item.name]));
      const results = await Promise.all(ids.map(async id => {
        try {
          await stat(assetPath(id));
          const mime = mimeByExtension[path.extname(names.get(id) || '').toLowerCase()];
          if (mime) assetMime.set(id, mime);
          return {id, available:true};
        }
        catch { return {id, available:false}; }
      }));
      sendJson(res, 200, {available:results.filter(item => item.available).map(item => item.id), missing:results.filter(item => !item.available).map(item => item.id)}); return;
    } catch (error) { sendJson(res, 400, {error:error.message || 'Could not validate project media.'}); return; }
  }
  if (req.url === '/api/ai/models' && req.method === 'GET') {
    sendJson(res,200,{...aiSelection,models:await modelCatalog()}); return;
  }
  if (req.url === '/api/ai/models' && req.method === 'POST') {
    try {
      const input=await readJson(req,10_000), key=String(input.apiKey||'').trim(), provider=detectProvider(key);
      if(!provider) { sendJson(res,422,{error:'Could not identify this key. Supported: OpenAI, Anthropic, Gemini, Groq, NVIDIA NIM, OpenRouter, and xAI.'}); return; }
      const modelName=String(input.model||providerDetails[provider].model).trim().slice(0,160);
      if(!modelName) { sendJson(res,400,{error:'Enter a model ID.'}); return; }
      const entry={id:randomUUID(),kind:'byok',provider,key,model:modelName,name:String(input.name||`${providerDetails[provider].label} · ${modelName}`).trim().slice(0,80),label:String(input.name||`${providerDetails[provider].label} · ${modelName}`).trim().slice(0,80),vision:true,supportsCaptions:providerDetails[provider].captions};
      byokModels.push(entry); aiSelection={mode:'byok',modelId:entry.id};
      sendJson(res,200,{...aiSelection,model:publicModel(entry),models:await modelCatalog()}); return;
    } catch(error) { sendJson(res,400,{error:error.message||'Unable to add this model.'}); return; }
  }
  if (req.url === '/api/ai/selection' && req.method === 'POST') {
    try {
      const input=await readJson(req,10_000), mode=['auto','local','byok'].includes(input.mode)?input.mode:null;
      if(!mode) { sendJson(res,422,{error:'Choose Auto, Local, or BYOK mode.'}); return; }
      const models=await modelCatalog(), modelId=String(input.modelId||'auto');
      if(mode==='auto') aiSelection={mode,modelId:'auto'};
      else {
        const selected=models.find(item=>item.id===modelId&&item.kind===(mode==='local'?'local':'byok'));
        if(!selected) { sendJson(res,422,{error:`Add or select an available ${mode==='local'?'local':'BYOK'} model first.`}); return; }
        aiSelection={mode,modelId};
      }
      sendJson(res,200,{...aiSelection,models}); return;
    } catch(error) { sendJson(res,400,{error:error.message||'Unable to update AI model selection.'}); return; }
  }
  const byokModelMatch=req.url?.match(/^\/api\/ai\/models\/([a-f0-9-]{36})$/);
  if(byokModelMatch&&req.method==='DELETE') {
    const index=byokModels.findIndex(item=>item.id===byokModelMatch[1]);
    if(index<0) { sendJson(res,404,{error:'BYOK model not found.'}); return; }
    byokModels.splice(index,1);
    if(aiSelection.modelId===byokModelMatch[1]) aiSelection={mode:'auto',modelId:'auto'};
    sendJson(res,200,{...aiSelection,models:await modelCatalog()}); return;
  }
  if (req.url === '/api/settings/provider-key' && req.method === 'GET') {
    sendJson(res,200,{...providerStatus(),...aiSelection,models:publicByokModels()}); return;
  }
  if (req.url === '/api/settings/provider-key' && req.method === 'DELETE') {
    byokModels.splice(0,byokModels.length); aiSelection={mode:'auto',modelId:'auto'}; sendJson(res,200,{...providerStatus(),...aiSelection,models:publicByokModels()}); return;
  }
  if (req.url === '/api/settings/provider-key' && req.method === 'POST') {
    try {
      const input=await readJson(req,10_000), key=String(input.apiKey||'').trim();
      const provider=detectProvider(key);
      if(!provider) { sendJson(res,422,{error:'Could not identify this key. Supported key formats: OpenAI, Anthropic, Gemini, Groq, NVIDIA NIM, OpenRouter, and xAI.'}); return; }
      const entry={id:randomUUID(),kind:'byok',provider,key,model:String(input.model||providerDetails[provider].model).slice(0,160),name:String(input.name||`${providerDetails[provider].label} · ${input.model||providerDetails[provider].model}`).slice(0,80),label:String(input.name||providerDetails[provider].label),vision:true,supportsCaptions:providerDetails[provider].captions};
      byokModels.push(entry); aiSelection={mode:'byok',modelId:entry.id};
      sendJson(res,200,{...providerStatus(),...aiSelection,models:publicByokModels()}); return;
    } catch(error) { sendJson(res,400,{error:error.message||'Unable to configure provider.'}); return; }
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
        assetMime.set(id, mimeByExtension[ext] || info.mimeType || 'application/octet-stream');
        stream.on('limit', () => { fileError = new Error('Video exceeds the 1 GB upload limit.'); });
        writes.push(pipeline(stream, createWriteStream(file)).catch(error => { fileError = error; }));
      });
      await new Promise((resolve,reject) => { bb.on('close',resolve); bb.on('error',reject); req.pipe(bb); });
      await Promise.all(writes);
      if (fileError) { await rm(file,{force:true}); throw fileError; }
      const metadata = await probe(file);
      await writeFile(path.join(uploadRoot, `${id}.meta.json`), JSON.stringify({id, filename, mimeType:assetMime.get(id), metadata}), 'utf8');
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
    const captionProvider=transcriptionProvider();
    if (!captionProvider||!providerDetails[captionProvider.provider].captions) { sendJson(res,503,{error:'Automatic captions require an OpenAI or Groq API key. Set one in AI Provider Settings.'}); return; }
    try {
      const input=await readJson(req); const source=assetPath(input.assetId); const metadata=await probe(source);
      if(!metadata.audio) throw new Error('This media has no audio track to caption.');
      const segments=await transcribeMedia(source,captionProvider);
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
    const prompt = String(input.prompt || '').slice(0, 4000);
    const chosenModel=await resolveAiModel(input,prompt);
    const useLocal=chosenModel.kind==='local';
    const aiConfig=useLocal?null:chosenModel;
    const chosenLocalModel=useLocal?chosenModel.model:localModel;
    const localToken = process.env.LM_STUDIO_API_TOKEN || process.env.LM_API_TOKEN;
    const localVision = useLocal && Boolean(localToken) && Boolean(chosenModel.vision);
    const clips = Array.isArray(input.clips) ? input.clips.slice(0, 20).map(c => ({assetId:String(c.assetId||''),name:String(c.name||'Clip').slice(0,180),durationSeconds:Number(c.durationSeconds)||0,trimStart:Number(c.trimStart)||0,trimEnd:Number(c.trimEnd)||0})) : [];
    if(!clips.length) throw new Error('Add media to the timeline before asking AI to edit.');
    const wantsTranscript=Boolean(input.includeTranscript)||/dialogue|speech|spoken|exact words|quote|caption|subtitle|transcript|transcribe|what .* say/i.test(prompt);
    const transcriptConfig=aiConfig&&providerDetails[aiConfig.provider]?.captions?aiConfig:(wantsTranscript&&input.aiMode==='auto'?transcriptionProvider():null);
    const evidence=[];
    for(let i=0;i<clips.length;i++) {
      const clip=clips[i]; if(!/^[a-f0-9-]{36}$/.test(clip.assetId)) throw new Error(`Clip ${i+1} has no valid local media asset.`);
      const source=assetPath(clip.assetId), metadata=await probe(source); clip.metadata=metadata;
      const start=Math.max(0,clip.trimStart), end=Math.min(metadata.duration,clip.trimEnd||metadata.duration);
      const frames=(!useLocal||localVision)&&metadata.width?await sampleFrames(source,start,end,2):[];
      const transcript=transcriptConfig&&wantsTranscript&&metadata.audio?(await transcribeMedia(source,transcriptConfig)).filter(s=>s.end>start&&s.start<end).slice(0,100):[];
      evidence.push({index:i,name:clip.name,trimStart:start,trimEnd:end,metadata,transcript,frames});
    }
    if(useLocal) {
      if(localVision) {
        const localContent=[{type:'text',text:`User request: ${prompt}. Work like a careful human editor: interpret the brief, review every supplied sample, build a hook-to-payoff rough cut, refine pacing and continuity, then check audio, captions, color, and delivery. Use only edits represented by supported cut/reorder decisions. Never claim an action was executed. You may inspect only the labeled sampled frames and metadata, not every moment. Preserve uncertain shots; keep cuts inside the supplied ranges. Captions enabled: ${Boolean(input.captionsEnabled)}. Return a concise process and evidence-based cut decisions.`}];
        for(const item of evidence){localContent.push({type:'text',text:`CLIP ${item.index} ${item.name}, trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)} seconds. Technical metadata: ${JSON.stringify(item.metadata)}`});for(const frame of item.frames){localContent.push({type:'text',text:`Clip ${item.index} sample at ${frame.time.toFixed(2)} seconds`});localContent.push({type:'image_url',image_url:{url:`data:image/jpeg;base64,${frame.data}`}});}}
        const base=(process.env.LM_STUDIO_BASE_URL||'http://127.0.0.1:1234/v1').replace(/\/$/,'');
        const localResponse=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${localToken}`,'Content-Type':'application/json'},body:JSON.stringify({model:chosenLocalModel,messages:[{role:'system',content:'You are Cut Studio, an experienced and careful human video editor. Return evidence-based edits only and never claim they were applied.'},{role:'user',content:localContent}],temperature:0.2,max_tokens:3000,response_format:{type:'json_schema',json_schema:{name:'cut_studio_edit_plan',strict:true,schema}}})});
        const payload=await localResponse.json();
        if(!localResponse.ok) throw new Error(payload?.error?.message||`LM Studio vision request failed (${localResponse.status}).`);
        const text=payload.choices?.[0]?.message?.content;
        if(!text) throw new Error(`Local vision model ${chosenLocalModel} returned no edit plan.`);
        const result=JSON.parse(text); result.engine='local'; result.model=chosenLocalModel; result.routerReason=chosenModel.reason;
        result.editDecisions=(result.editDecisions||[]).filter(d=>Number.isInteger(d.clipIndex)&&d.clipIndex>=0&&d.clipIndex<clips.length).map(d=>{const clip=clips[d.clipIndex],lo=Math.max(0,clip.trimStart),hi=Math.min(clip.durationSeconds,clip.trimEnd||clip.durationSeconds);let a=Math.max(lo,Math.min(hi,Number(d.inPoint))),b=Math.max(lo,Math.min(hi,Number(d.outPoint)));if(b-a<0.3){a=lo;b=hi;}return {...d,position:Math.max(0,Math.min(clips.length-1,Number(d.position)||0)),inPoint:a,outPoint:b};});
        res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(result)); return;
      }
      const clipSummary=evidence.map(c=>`${c.index}: ${c.name}, ${(c.trimEnd-c.trimStart).toFixed(1)}s, ${c.metadata.width||'audio'}x${c.metadata.height||''}, ${c.metadata.fps||0}fps`).join('; ');
      const localPrompt=`User brief: "${prompt.slice(0,1000)}". Timeline facts: ${clipSummary}. You are a human editor with metadata only: you cannot see frames or hear sound. Never invent footage events, dialogue, trims, or claim to inspect audio. Think through brief, organize clips, propose a story/pacing approach, then note checks for picture, audio, captions, and export. Return JSON with title, summary, steps (order/action/detail), and editDecisions: []. Keep it concise and evidence-aware.`;
      const local = await runLocalChat(localPrompt,chosenLocalModel,'You are Cut Studio, a meticulous human editor. Output valid JSON only. Never claim to have applied an edit.');
      const cleaned=(local.stdout||'').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\u001b\][^\u0007]*(?:\u0007|$)/g,'').trim();
      if(!cleaned) throw new Error(`Local model ${chosenLocalModel} returned an empty recommendation.`);
      const jsonStart=cleaned.indexOf('{'),jsonEnd=cleaned.lastIndexOf('}');
      let result;
      if(jsonStart>=0&&jsonEnd>jsonStart) { try { result=JSON.parse(cleaned.slice(jsonStart,jsonEnd+1)); } catch {} }
      if(!result||typeof result!=='object') { const summary=cleaned.slice(-1500).trim(); result={title:'Local AI edit plan',summary,steps:[{order:1,action:'Review the footage',detail:'This local text model only received filenames and technical metadata. Inspect the clips before choosing trims.'},{order:2,action:'Refine and check delivery',detail:'Review pacing, audio, captions, picture, and the final render.'}],editDecisions:[]}; }
      result.engine='local'; result.model=chosenLocalModel; result.routerReason=chosenModel.reason;
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(result)); return;
    }
    const content=[{type:'input_text',text:`User request: ${prompt}\nAct like a meticulous human editor working in visible passes: interpret the brief; review each supplied clip sample and technical properties; find a story arc and choose a hook; build a rough cut; refine trims, order, and pacing; then list checks for continuity, sound, captions, color, and delivery. Only propose changes the editor can actually apply in this timeline (trim, keep/remove, reorder); describe other finishing work as review steps, not completed actions. Captions enabled: ${Boolean(input.captionsEnabled)}. You can inspect only supplied sampled frames and transcript excerpts, not every moment; samples are approximate. Never invent unseen actions or claim edits were executed. Preserve uncertain clips. Keep in/out within each supplied trim range and at least 0.3 seconds for kept clips. Include a concise, ordered human-editing process and evidence-based reason for every proposed cut.`}];
    for(const item of evidence){content.push({type:'input_text',text:`CLIP ${item.index} (${item.name}), trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)}s; metadata ${JSON.stringify(item.metadata)}; transcript ${JSON.stringify(item.transcript)}`});for(const frame of item.frames){content.push({type:'input_text',text:`Sample from clip ${item.index} at source ${frame.time.toFixed(2)}s`});content.push({type:'input_image',image_url:`data:image/jpeg;base64,${frame.data}`,detail:'low'});}}
    let text;
    if(aiConfig.provider==='openai') {
      const ai=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${aiConfig.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:aiConfig.model,input:[{role:'user',content}],text:{format:{type:'json_schema',name:'cut_studio_edit_plan',strict:true,schema}}})});
      const payload=await ai.json();
      if(!ai.ok){sendJson(res,502,{error:payload?.error?.message||`OpenAI request failed (${ai.status}).`});return;}
      text=payload.output_text||payload.output?.flatMap(item=>item.content||[]).find(item=>item.type==='output_text')?.text;
    } else if(aiConfig.provider==='anthropic') {
      const blocks=[{type:'text',text:content[0].text}];
      for(const item of evidence){blocks.push({type:'text',text:`CLIP ${item.index} ${item.name}, trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)} seconds; metadata ${JSON.stringify(item.metadata)}; transcript ${JSON.stringify(item.transcript)}.`});for(const frame of item.frames)blocks.push({type:'image',source:{type:'base64',media_type:'image/jpeg',data:frame.data}});}
      const ai=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':aiConfig.key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:aiConfig.model,max_tokens:4096,system:'You are Cut Studio, a careful video editor. Respond with one valid JSON object matching this schema, and never claim edits were executed: '+JSON.stringify(schema),messages:[{role:'user',content:blocks}]})});
      const payload=await ai.json();
      if(!ai.ok){sendJson(res,502,{error:payload?.error?.message||`Anthropic request failed (${ai.status}).`});return;}
      text=payload.content?.filter(block=>block.type==='text').map(block=>block.text).join('\n');
    } else if(aiConfig.provider==='gemini') {
      const parts=[{text:content[0].text}];
      for(const item of evidence){parts.push({text:`CLIP ${item.index} ${item.name}, trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)} seconds; metadata ${JSON.stringify(item.metadata)}; transcript ${JSON.stringify(item.transcript)}.`});for(const frame of item.frames)parts.push({inlineData:{mimeType:'image/jpeg',data:frame.data}});}
      const ai=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiConfig.model)}:generateContent`,{method:'POST',headers:{'x-goog-api-key':aiConfig.key,'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:'You are Cut Studio, a careful video editor. Never claim edits were executed.'}]},contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',responseSchema:geminiSchema(schema)}})});
      const payload=await ai.json();
      if(!ai.ok){sendJson(res,502,{error:payload?.error?.message||`Gemini request failed (${ai.status}).`});return;}
      text=payload.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('');
    } else {
      const messages=[{role:'system',content:'You are Cut Studio, a careful video editor. Return a concise valid JSON object matching the supplied schema. Never claim edits were executed.'},{role:'user',content:[{type:'text',text:content[0].text},...evidence.flatMap(item=>[{type:'text',text:`CLIP ${item.index} ${item.name}, trim ${item.trimStart.toFixed(2)}-${item.trimEnd.toFixed(2)} seconds; metadata ${JSON.stringify(item.metadata)}; transcript ${JSON.stringify(item.transcript)}.`},...item.frames.flatMap(frame=>[{type:'text',text:`Sample from clip ${item.index} at ${frame.time.toFixed(2)} seconds`},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${frame.data}`}}])])]}];
      const endpoints={groq:'https://api.groq.com/openai/v1/chat/completions',openrouter:'https://openrouter.ai/api/v1/chat/completions',xai:'https://api.x.ai/v1/chat/completions',nvidia:'https://integrate.api.nvidia.com/v1/chat/completions'};
      messages[0].content+=` Required JSON schema: ${JSON.stringify(schema)}`;
      const ai=await fetch(endpoints[aiConfig.provider],{method:'POST',headers:{Authorization:`Bearer ${aiConfig.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:aiConfig.model,messages,temperature:0.2,max_tokens:3000,response_format:{type:'json_object'}})});
      const payload=await ai.json();
      if(!ai.ok){sendJson(res,502,{error:payload?.error?.message||`${providerDetails[aiConfig.provider].label} request failed (${ai.status}).`});return;}
      text=payload.choices?.[0]?.message?.content;
    }
    if (!text) throw new Error('AI returned no edit plan.');
    const result=JSON.parse(text);
    result.engine='byok'; result.provider=aiConfig.label||providerDetails[aiConfig.provider].label; result.model=aiConfig.model; result.routerReason=chosenModel.reason;
    result.editDecisions=(result.editDecisions||[]).filter(d=>Number.isInteger(d.clipIndex)&&d.clipIndex>=0&&d.clipIndex<clips.length).map(d=>{const clip=clips[d.clipIndex],lo=Math.max(0,clip.trimStart),hi=Math.min(clip.durationSeconds,clip.trimEnd||clip.durationSeconds);let a=Math.max(lo,Math.min(hi,Number(d.inPoint))),b=Math.max(lo,Math.min(hi,Number(d.outPoint)));if(b-a<0.3){a=lo;b=hi;}return {...d,position:Math.max(0,Math.min(clips.length-1,Number(d.position)||0)),inPoint:a,outPoint:b};});
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify({error: error.message || 'Unable to create an edit plan.'}));
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Cut Studio media and AI backend listening on ${process.env.HOST || '127.0.0.1'}:${port}`));
