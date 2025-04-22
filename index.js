 /* ------------------------------------------------------------------
   index.js  –  OCR robusto   v3.0
   ✔ OpenAI Assistant V2  (primario)
   ✔ Google Cloud Vision v1  (fallback automático)
   ✔ Parseo post‑OCR “23‑5 → número 23 / straight 5”
   ✔ Mejor manejo de errores y reintentos
   ------------------------------------------------------------------ */

"use strict";

// ──────────────────────────────────────────────────────────────────
// 1 ▸  DEPENDENCIAS
// ──────────────────────────────────────────────────────────────────
const path            = require("path");
const express         = require("express");
const multer          = require("multer");
const axios           = require("axios");
const FormData        = require("form-data");
const sharp           = require("sharp");
const { MongoClient } = require("mongodb");
const dayjs           = require("dayjs");
const vision          = require("@google-cloud/vision");

// ──────────────────────────────────────────────────────────────────
// 2 ▸  CONFIGURACIÓN – Variables de entorno
// ──────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT             || 3000;
const MONGODB_URI      = process.env.MONGODB_URI      || "";
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY   || "";
const ASSISTANT_ID     = process.env.ASSISTANT_ID     || "";
const OPENAI_ORG_ID    = process.env.OPENAI_ORG_ID    || "";
// Para Google Vision usa credenciales vía GOOGLE_APPLICATION_CREDENTIALS
// o bien GOOGLE_CLOUD_KEY_JSON (string con la key).

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Falta OPENAI_API_KEY o ASSISTANT_ID");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────
// 3 ▸  APP EXPRESS  + UPLOAD
// ──────────────────────────────────────────────────────────────────
const app     = express();
const upload  = multer({ storage: multer.memoryStorage() });
app.use(express.static("public"));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ──────────────────────────────────────────────────────────────────
// 4 ▸  API CLIENT genérico con reintentos
// ──────────────────────────────────────────────────────────────────
const ApiClient = {
  async request(cfg, retries = 3, delay = 1000) {
    let err;
    for (let i = 0; i < retries; i++) {
      try { return await axios(cfg); } catch (e) {
        err = e;
        const again = !e.response || e.response.status >= 500;
        if (!again || i === retries - 1) break;
        console.log(`↺  Retry ${i + 1}/${retries}…`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw err;
  },
  openaiHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta":  "assistants=v2",
      "OpenAI-Organization": OPENAI_ORG_ID,
      ...extra,
    };
  },
};

// ──────────────────────────────────────────────────────────────────
// 5 ▸  OCR SERVICE  (OpenAI → fallback Vision)
// ──────────────────────────────────────────────────────────────────
const visionClient = new vision.ImageAnnotatorClient();

const OcrService = {
  async resize(buf) {
    return sharp(buf).resize({ width: 2000, height: 2000, fit: "inside" }).toBuffer();
  },

  /* ---------- OPENAI PATH --------------------------------------------------- */
  async uploadToOpenAI(buffer, filename, mimetype) {
    const fd = new FormData();
    fd.append("purpose", "assistants");
    fd.append("file", buffer, { filename, contentType: mimetype });
    const r = await ApiClient.request({
      method: "post", url: "https://api.openai.com/v1/files",
      headers: { ...ApiClient.openaiHeaders(), ...fd.getHeaders() }, data: fd,
    });
    return r.data.id;
  },

  prompt(serverTime) {
    const t = serverTime.format("YYYY‑MM‑DD HH:mm:ss Z");
    return `
La hora del servidor es ${t}.
Si un texto tiene el formato <número><guion><monto> o <número> <monto>$,
interpreta que es “número de apuesta” y “monto straight”.
Ejemplos:
  23-5     → número 23, straight 5
  123 2.5  → número 123, straight 2.5
Devuelve SOLO:
{
 "ticketInfo": {...},
 "jugadas":[ {...} ]
}
${/* ——— Pega aquí TODO tu bloque de reglas internas tal cual ——— */""}`;
  },

  async createRun(fileId, prompt) {
    const r = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/threads/runs",
      headers: ApiClient.openaiHeaders({ "Content-Type": "application/json" }),
      data: {
        assistant_id: ASSISTANT_ID,
        thread: { messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_file", image_file: { file_id: fileId } },
        ]}]},
        response_format: { type: "json_object" },
      },
    });
    return { threadId: r.data.thread_id, runId: r.data.id, status: r.data.status };
  },

  async waitRun(threadId, runId, status) {
    const final = new Set(["completed", "failed", "incomplete", "cancelled", "expired"]);
    while (!final.has(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const r = await ApiClient.request({
        method: "get",
        url: `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        headers: ApiClient.openaiHeaders(),
      });
      status = r.data.status;
    }
    return status;
  },

  async fetchAnswer(threadId) {
    const r = await ApiClient.request({
      method: "get",
      url: `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      headers: ApiClient.openaiHeaders(),
    });
    const msg = r.data.data.find(m => m.role === "assistant");
    if (!msg) throw new Error("Assistant sin respuesta");
    return msg.content;
  },

  /* ---------- GOOGLE VISION FALLBACK --------------------------------------- */
  async visionText(buffer) {
    const [res] = await visionClient.textDetection({ image: { content: buffer }});
    return res.textAnnotations?.[0]?.description || "";
  },

  /* ---------- POST‑PARSE & NORMALIZACIÓN ----------------------------------- */
  parseJSON(raw) {
    try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
    catch { return null; }
  },

  splitGuion(j) {                       // 23‑5 → número 23, straight 5
    if (j.numero?.includes("-")) {
      const [num, m] = j.numero.split("-");
      const val = parseFloat((m||"").replace(/[^0-9.]/g,""));
      if (!isNaN(val) && (!j.straight || j.straight === 0)) {
        j.numero = num.trim(); j.straight = val;
      }
    }
    return j;
  },

  toClient(parsed) {
    if (!parsed?.jugadas) return { jugadas: [] };
    const jugadas = parsed.jugadas.map(j => {
      j = this.splitGuion(j);
      const total = (j.straight||0)+(j.box||0)+(j.combo||0);
      const out = { numeros: j.numero||"", montoApostado: total,
        straight: j.straight||0, box: j.box||0, combo: j.combo||0 };
      if (j.esNumeroDudoso||j.esMontoDudoso||j.esTipoJuegoDudoso||j.esModalidadDudosa) {
        out.esDudoso = true;
        out.detallesDudas = {
          numero: !!j.esNumeroDudoso, monto: !!j.esMontoDudoso,
          tipoJuego: !!j.esTipoJuegoDudoso, modalidad: !!j.esModalidadDudosa,
        };
      }
      return out;
    });
    const i = parsed.ticketInfo||{};
    return { jugadas, ticketInfo: { fecha:i.fecha||"", track:i.track||"", esDudoso:i.esFechaDudosa||i.esTrackDudoso||false }};
  },

  /* ---------- FUNCIÓN ORQUESTADORA ---------------------------------------- */
  async processImage(file) {
    const buf      = await this.resize(file.buffer);
    const serverT  = dayjs();
    try {
      // 1º OpenAI
      const fileId  = await this.uploadToOpenAI(buf, file.originalname, file.mimetype);
      const prompt  = this.prompt(serverT);
      const { threadId, runId, status } = await this.createRun(fileId, prompt);
      const final   = await this.waitRun(threadId, runId, status);
      if (final !== "completed") throw new Error(`Run ${final}`);
      const raw     = await this.fetchAnswer(threadId);
      const parsed  = this.parseJSON(raw);
      if (!parsed) throw new Error("JSON inválido");
      return { metodo:"openai", resultado: this.toClient(parsed), debug:{threadId,runId,raw} };
    } catch (e) {
      console.warn("⚠️  OpenAI falló → Fallback Vision:", e.message);
      // 2º Google Vision
      const text   = await this.visionText(buf);
      const parsed = this.basicoDesdeTexto(text);   // usa heurística simple
      return { metodo:"vision", resultado:this.toClient(parsed), debug:{text} };
    }
  },

  /* Heurística mínima por si cae a Vision */
  basicoDesdeTexto(txt="") {
    const jugadas = [];
    txt.split(/\n+/).forEach(l => {
      const m = l.match(/^(\d{2,4})\s*[- ]\s*(\d+(?:\.\d+)?)/);
      if (m) jugadas.push({ numero:m[1], straight:parseFloat(m[2]) });
    });
    return { jugadas };
  },
};

// ──────────────────────────────────────────────────────────────────
// 6 ▸  RUTA /ocr
// ──────────────────────────────────────────────────────────────────
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) return res.json({ success:false, error:"No se recibió imagen" });
  try {
    const out = await OcrService.processImage(req.file);
    // guardado opcional en MongoDB
    if (db) {
      await db.collection("ticketsOCR").insertOne({
        createdAt:new Date(), metodo:out.metodo, ...out.debug, resultado:out.resultado,
      });
    }
    return res.json({ success:true, ...out });
  } catch (err) {
    console.error(err);
    return res.json({ success:false, error:err.message });
  }
});

// ──────────────────────────────────────────────────────────────────
// 7 ▸  MONGO (opcional, igual que antes)
// ──────────────────────────────────────────────────────────────────
let db = null;
(async () => {
  if (!MONGODB_URI) return;
  try {
    const client = await new MongoClient(MONGODB_URI).connect();
    db = client.db(); console.log("✔ MongoDB conectado");
  } catch (e) { console.error("Mongo error:", e.message); }
})();

// ──────────────────────────────────────────────────────────────────
// 8 ▸  SERVER
// ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🌐  Server on ${PORT}`));
