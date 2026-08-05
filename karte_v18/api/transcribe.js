/**
 * 音声文字起こしAPI (Vercel Serverless Function)
 * Groq Whisper API を使用（無料・高速）
 * POST /api/transcribe  multipart/form-data { audio: File }
 */

export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  }

  try {
    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Parse multipart form data manually
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'Missing multipart boundary' });
    }

    const boundary = boundaryMatch[1];
    const parts = parseMultipart(body, boundary);

    const audioPart = parts.find(p => p.name === 'audio');
    if (!audioPart) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const initialPrompt = parts.find(p => p.name === 'initial_prompt')?.value || '';

    // Call Groq Whisper API (native FormData + File for proper multipart)
    const audioFile = new File(
      [audioPart.data],
      audioPart.filename || 'recording.webm',
      { type: audioPart.contentType || 'audio/webm' }
    );

    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'ja');
    formData.append('response_format', 'json');
    if (initialPrompt) {
      formData.append('prompt', initialPrompt);
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Groq API error:', groqRes.status, errText);
      return res.status(502).json({ error: `Groq API error: ${groqRes.status}` });
    }

    const result = await groqRes.json();
    return res.status(200).json({
      success: true,
      transcript: result.text || '',
    });

  } catch (e) {
    console.error('Transcribe error:', e);
    return res.status(500).json({ error: e.message });
  }
}

/** Simple multipart parser */
function parseMultipart(body, boundary) {
  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  const endDelimiter = Buffer.from(`--${boundary}--`);

  let start = indexOf(body, delimiter) + delimiter.length + 2; // skip \r\n
  while (start < body.length) {
    const end = indexOf(body, delimiter, start);
    if (end === -1) break;

    const part = body.slice(start, end - 2); // remove trailing \r\n
    const headerEnd = indexOf(part, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) { start = end + delimiter.length + 2; continue; }

    const headerStr = part.slice(0, headerEnd).toString('utf-8');
    const data = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (nameMatch) {
      if (filenameMatch) {
        parts.push({
          name: nameMatch[1],
          filename: filenameMatch[1],
          contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
          data: data,
        });
      } else {
        parts.push({
          name: nameMatch[1],
          value: data.toString('utf-8'),
        });
      }
    }

    start = end + delimiter.length + 2;
    if (indexOf(body, endDelimiter, end) === end) break;
  }
  return parts;
}

function indexOf(buf, search, from = 0) {
  for (let i = from; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
