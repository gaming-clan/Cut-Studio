import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
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
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ok: true, configured: Boolean(process.env.OPENAI_API_KEY)})); return;
  }
  if (req.method !== 'POST' || req.url !== '/api/edit-plan') {
    res.writeHead(404).end(JSON.stringify({error: 'Not found'})); return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.writeHead(503, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'OPENAI_API_KEY is not configured on the backend.'})); return;
  }
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error('Request is too large.'); }
    const input = JSON.parse(raw);
    const prompt = String(input.prompt || '').slice(0, 4000);
    const clips = Array.isArray(input.clips) ? input.clips.slice(0, 100).map(c => ({name: String(c.name || 'Clip').slice(0, 180), sizeBytes: Number(c.sizeBytes) || 0})) : [];
    const instructions = `You are Cut Studio, an assistant that plans practical non-destructive video edits. Return concise actionable steps in timeline order. Refer to clips by filename when useful. Do not claim to have inspected video or audio: you only receive filenames and sizes. Do not claim edits were executed. Include sensible stages such as story/pacing, trims, captions, audio, color, and quality control only when relevant. User request: ${prompt}. Captions enabled: ${Boolean(input.captionsEnabled)}. Clip metadata: ${JSON.stringify(clips)}`;
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
server.listen(port, '0.0.0.0', () => console.log(`Cut Studio AI backend listening on ${port}`));
