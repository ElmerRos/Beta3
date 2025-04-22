 /*
  index.js – versión 2025‑04 ‑ OCR híbrido (OpenAI → fallback Google Vision)
  ----------------------------------------------------------------------
  ▸ Reescribe completamente la ruta /ocr para que primero intente el
    flujo asistente (OpenAI Assistants v2) y, si algo falla (error HTTP,
    runStatus ≠ "completed" o respuesta malformada), haga un segundo
    intento con Google Cloud Vision v1.
  ▸ El resto de tu aplicación (Mongo, frontend, rutas) permanece igual:
    solo se movió toda la lógica OCR a una función `processOCR` que
    decide el proveedor.
  ▸ Dependencias nuevas que debes instalar **una sola vez**:
      npm i @google-cloud/vision form-data sharp axios dayjs multer express
  ▸ Variables de entorno requeridas (en Render, Railway o local):
      OPENAI_API_KEY           → tu clave OpenAI
      ASSISTANT_ID             → ID del assistant que ya creaste
      OPENAI_ORG_ID (opcional) → org‑ID si lo usas
      GCLOUD_PROJECT           → ID del proyecto GCP
      GOOGLE_APPLICATION_CREDENTIALS → ruta al JSON de servicio (Render: usa
                                        Secret + disco, o pega el JSON en
                                        la variable y escribe a /tmp)
*/

'use strict';

const path          = require('path');
const express       = require('express');
const multer        = require('multer');
const axios         = require('axios');
const FormData      = require('form-data');
const sharp         = require('sharp');
const dayjs         = require('dayjs');
const { MongoClient } = require('mongodb');

// ────────────────────────────────  CONSTANTES  ────────────────────────────────
const PORT            = process.env.PORT               || 3000;
const MONGODB_URI     = process.env.MONGODB_URI        || '';
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY     || '';
const ASSISTANT_ID    = process.env.ASSISTANT_ID       || '';
const OPENAI_ORG_ID   = process.env.OPENAI_ORG_ID      || '';

// Google
const { v1: Vision }  = require('@google-cloud/vision');
const hasGCloudCreds  = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
const visionClient    = hasGCloudCreds ? new Vision.ImageAnnotatorClient() : null;

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error('❌  Debes definir OPENAI_API_KEY y ASSISTANT_ID en tus variables de entorno');
  process.exit(1);
}

// ────────────────────────────────  EXPRESS APP  ───────────────────────────────
const app     = express();
const upload  = multer({ storage: multer.memoryStorage() });
app.use(express.static('public'));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ───────────────────────────────  API CLIENT WRAPPER  ─────────────────────────
const ApiClient = {
  async request (config, retries = 3, backoff = 1000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try { return await axios(config); } catch (err) {
        lastErr = err;
        const retriable = !err.response || err.response.status >= 500;
        if (!retriable || i === retries - 1) break;
        await new Promise(r => setTimeout(r, backoff * Math.pow(2, i)));
      }
    }
    throw lastErr;
  },
  openaiHeaders (extra = {}) {
    return {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta'      : 'assistants=v2',
      'OpenAI-Organization': OPENAI_ORG_ID,
      ...extra
    };
  }
};

// ───────────────────────────────  OCR HELPERS  ───────────────────────────────
const OcrService = {
  async resize (buffer) {
    return sharp(buffer).resize({ width: 2000, height: 2000, fit: 'inside' }).toBuffer();
  },
  async uploadToOpenAI (buffer, filename, type) {
    const fd = new FormData();
    fd.append('purpose', 'assistants');
    fd.append('file', buffer, { filename, contentType: type });
    const r = await ApiClient.request({
      method : 'post',
      url    : 'https://api.openai.com/v1/files',
      data   : fd,
      headers: { ...ApiClient.openaiHeaders(), ...fd.getHeaders() }
    });
    return r.data.id;
  },
  detailedPrompt (serverTime) {
    const t = serverTime.format('YYYY-MM-DD HH:mm:ss Z');
    return `Analiza la imagen adjunta… La hora del servidor es ${t}. Devuelve SOLO el objeto JSON pedido…`;
  },
  async runAssistant (fileId, prompt) {
    const r = await ApiClient.request({
      method : 'post',
      url    : 'https://api.openai.com/v1/threads/runs',
      headers: { ...ApiClient.openaiHeaders(), 'Content-Type': 'application/json' },
      data   : {
        assistant_id   : ASSISTANT_ID,
        thread         : { messages: [{ role: 'user', content: [ { type: 'text', text: prompt }, { type: 'image_file', image_file: { file_id: fileId } } ] }] },
        response_format: { type: 'json_object' }
      }
    });
    return { runId: r.data.id, threadId: r.data.thread_id, status: r.data.status };
  },
  async poll (threadId, runId, status) {
    const finals = new Set(['completed','failed','incomplete','cancelled','expired']);
    while (!finals.has(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const r = await ApiClient.request({
        method : 'get',
        url    : `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        headers: ApiClient.openaiHeaders()
      });
      status = r.data.status;
    }
    return status;
  },
  async assistantResponse (threadId) {
    const r = await ApiClient.request({
      method : 'get',
      url    : `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      headers: ApiClient.openaiHeaders()
    });
    const msg = r.data.data.find(m => m.role === 'assistant');
    if (!msg) throw new Error('assistant vacío');
    return msg.content;
  },
  safeJson (raw) {
    try {
      if (typeof raw === 'string') return JSON.parse(raw);
      if (Array.isArray(raw)) {
        const p = raw.find(x => x.type === 'text');
        return p?.text?.value ? JSON.parse(p.text.value) : null;
      }
      if (raw && raw.type === 'text') return JSON.parse(raw.text.value);
    } catch { /* fallthrough */ }
    return null;
  }
};

// ────────────────────────────  GOOGLE VISION FALLBACK  ───────────────────────
async function googleVisionOCR (buffer) {
  if (!visionClient) throw new Error('Google Vision no está configurado');
  const [result] = await visionClient.textDetection({ image: { content: buffer } });
  const text = result.fullTextAnnotation?.text || '';
  // ↳ TODO: aquí podrías aplicar regex/IA para convertir el texto libre a la
  // estructura { ticketInfo, jugadas }. Por ahora enviamos todo el texto.
  return {
    ticketInfo: null,
    jugadas   : [{ numero: text.slice(0, 60).replace(/\n/g, ' '), straight: 0, box: 0, combo: 0 }]
  };
}

// ─────────────────────────────  WORKER PRINCIPAL  ────────────────────────────
async function processOCR (file) {
  const resized = await OcrService.resize(file.buffer);
  const serverTime = dayjs();

  // —— PRIMER INTENTO : OpenAI Assistant ————————————————————————————
  try {
    const fileId               = await OcrService.uploadToOpenAI(resized, file.originalname, file.mimetype);
    const prompt               = OcrService.detailedPrompt(serverTime);
    const { threadId, runId, status } = await OcrService.runAssistant(fileId, prompt);
    const finalStatus          = await OcrService.poll(threadId, runId, status);
    if (finalStatus !== 'completed') throw new Error(`Assistant terminó con estado ${finalStatus}`);
    const raw                  = await OcrService.assistantResponse(threadId);
    const parsed               = OcrService.safeJson(raw);
    if (!parsed)               throw new Error('JSON inválido de assistant');
    return { provider: 'openai', resultado: parsed, debug: { threadId, runId } };
  } catch (err) {
    console.warn('⚠️  OpenAI OCR falló, usando fallback →', err.message);
  }

  // —— SEGUNDO INTENTO : Google Vision  ————————————————————————————
  const parsed = await googleVisionOCR(resized);
  return { provider: 'gcloud', resultado: parsed, debug: {} };
}

// ───────────────────────────────  RUTA /ocr  ────────────────────────────────
app.post('/ocr', upload.single('ticket'), async (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'No se recibió ninguna imagen' });
  try {
    const { provider, resultado, debug } = await processOCR(req.file);

    // Guarda en Mongo si existe conexión
    if (MONGODB_URI && db) {
      await db.collection('ticketsOCR').insertOne({ createdAt: new Date(), provider, resultado, debug });
    }

    res.json({ success: true, provider, resultado, debug });
  } catch (e) {
    console.error('❌  OCR error →', e);
    res.json({ success: false, error: e.message });
  }
});

// ───────────────────────────────  MONGODB  ───────────────────────────────────
let db = null;
if (MONGODB_URI) {
  MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true })
    .then(client => { db = client.db(); console.log('✓ Mongo conectado'); })
    .catch(err   => console.error('Mongo error', err.message));
}

// ───────────────────────────────  SERVER  ────────────────────────────────────
app.listen(PORT, () => console.log('Servidor en puerto', PORT));
