 "use strict";

/* ------------------------------------------------------------------
   ▸ 1. DEPENDENCIAS
--------------------------------------------------------------------*/
const path   = require("path");
const fs     = require("fs");
const express= require("express");
const multer = require("multer");
const axios  = require("axios");
const FormData = require("form-data");
const sharp  = require("sharp");
const { MongoClient } = require("mongodb");
const dayjs  = require("dayjs");
const vision = require("@google-cloud/vision");

/* ------------------------------------------------------------------
   ▸ 2. VARIABLES DE ENTORNO
--------------------------------------------------------------------*/
const PORT            = process.env.PORT             || 3000;
const MONGODB_URI     = process.env.MONGODB_URI      || "";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY   || "";
const ASSISTANT_ID    = process.env.ASSISTANT_ID     || "";
const OPENAI_ORG_ID   = process.env.OPENAI_ORG_ID    || "";
const GOOGLE_CRED_JSON= process.env.GOOGLE_CREDENTIALS_JSON || "";

/* ------------------------------------------------------------------
   ▸ 3. CONFIG APP
--------------------------------------------------------------------*/
const app    = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.static("public"));          //  archivos estáticos

/* ------------------------------------------------------------------
   ▸ 4. CLIENTES API
--------------------------------------------------------------------*/
const ApiClient = {
  async request(config, retries = 3, delay = 1000) {
    let e;
    for (let i = 0; i < retries; i++) {
      try { return await axios(config); }
      catch (err) {
        e = err;
        const retryable = !err.response || err.response.status >= 500;
        if (!retryable || i === retries - 1) break;
        console.log(`[OpenAI] Reintento ${i + 1}/${retries} …`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw e;
  },
  headers(extra = {}) {
    return {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "assistants=v2",
      "OpenAI-Organization": OPENAI_ORG_ID,
      ...extra
    };
  }
};

// Google Vision – cliente con credenciales en memoria
let visionClient = null;
if (GOOGLE_CRED_JSON) {
  try {
    const creds = JSON.parse(GOOGLE_CRED_JSON);
    visionClient = new vision.ImageAnnotatorClient({ credentials: creds });
  } catch (err) {
    console.error("❌ Credenciales JSON de Google Vision mal formateadas.", err);
  }
}

/* ------------------------------------------------------------------
   ▸ 5. SERVICIO OCR (OpenAI + fallback Vision)
--------------------------------------------------------------------*/
const OcrService = {

  /* -------- Utilidades -------- */
  async resizeImage(buf) {
    return sharp(buf).resize({ width: 2000, height: 2000, fit: "inside" }).toBuffer();
  },

  /* -------- 5.1 OpenAI -------- */
  async runOpenAI(buf, filename, mime, serverTime) {
    // 1 subir
    const form = new FormData();
    form.append("purpose", "assistants");
    form.append("file", buf, { filename, contentType: mime });
    const up = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/files",
      data: form,
      headers: { ...ApiClient.headers(), ...form.getHeaders() }
    });
    const fileId = up.data.id;

    // 2 prompt
    const prompt = this.buildPrompt(serverTime);

    // 3 crear run
    const run = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/threads/runs",
      data: {
        assistant_id: ASSISTANT_ID,
        thread: {
          messages: [
            { role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_file", image_file: { file_id: fileId } }
              ]}
          ]
        },
        response_format: { type: "json_object" }
      },
      headers: ApiClient.headers({ "Content-Type": "application/json" })
    });

    const { thread_id: threadId, id: runId, status } = run.data;

    // 4 esperar
    const finalStates = new Set(["completed", "failed", "cancelled", "expired", "incomplete"]);
    let cur = status;
    while (!finalStates.has(cur)) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await ApiClient.request({
        method: "get",
        url: `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        headers: ApiClient.headers()
      });
      cur = st.data.status;
    }
    if (cur !== "completed") throw new Error(`Run terminó en estado ${cur}`);

    // 5 respuesta
    const resp = await ApiClient.request({
      method: "get",
      url: `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      headers: ApiClient.headers()
    });
    const msg = resp.data.data.find(m => m.role === "assistant");
    if (!msg) throw new Error("Assistant no devolvió mensaje");

    return { provider: "openai", raw: msg.content };
  },

  /* -------- 5.2 Google Vision -------- */
  async runVision(buf) {
    if (!visionClient) throw new Error("Google Vision no configurado");
    const [result] = await visionClient.annotateImage({
      image: { content: buf },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
    });
    const fullText = result.fullTextAnnotation?.text || "";
    return { provider: "gvision", raw: fullText };
  },

  /* -------- 5.3 Prompt (igual al tuyo) -------- */
  buildPrompt(now) {
    const ts = now.format("YYYY-MM-DD HH:mm:ss Z");
    return `Por favor, analiza la imagen adjunta de un ticket de lotería manuscrito… La hora actual del servidor es ${ts}. Devuelve SOLO el JSON…`; //  ⚠ pon aquí tu prompt completo
  },

  /* -------- 5.4 Parser / Transform -------- */
  parse(content) {
    if (typeof content === "string") {
      try { return JSON.parse(content); } catch { return null; }
    }
    if (Array.isArray(content)) {
      const part = content.find(c => c.type === "text");
      if (part?.text?.value) {
        try { return JSON.parse(part.text.value); } catch { /* ignore */ }
      }
    }
    return null;
  },

  toClient(parsed) {
    if (!parsed?.jugadas) return { jugadas: [] };
    const jugadas = parsed.jugadas.map(j => ({
      numeros: j.numero || "",
      montoApostado: (j.straight||0)+(j.box||0)+(j.combo||0),
      straight: j.straight||0,
      box:      j.box||0,
      combo:    j.combo||0,
      esDudoso: !!(j.esNumeroDudoso||j.esMontoDudoso||j.esTipoJuegoDudoso||j.esModalidadDudosa)
    }));
    return { jugadas };
  }
};

/* ------------------------------------------------------------------
   ▸ 6. MONGODB (igual que antes, opcional)
--------------------------------------------------------------------*/
let db = null;
if (MONGODB_URI) {
  MongoClient.connect(MONGODB_URI, { useUnifiedTopology: true })
    .then(cli => { db = cli.db(); console.log("✓ Conectado a MongoDB"); })
    .catch(e  => console.error("Mongo error:", e.message));
}

/* ------------------------------------------------------------------
   ▸ 7. RUTA /ocr  (OpenAI → Vision fallback)
--------------------------------------------------------------------*/
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) return res.json({ success:false, error:"No se recibió imagen" });
  const now = dayjs();

  try {
    const resized = await OcrService.resizeImage(req.file.buffer);
    let result;
    try {
      result = await OcrService.runOpenAI(resized, req.file.originalname, req.file.mimetype, now);
    } catch (err) {
      console.warn("⚠ OpenAI falló, intentando Google Vision…", err.message);
      result = await OcrService.runVision(resized);        // puede lanzar error si Vision no está listo
    }

    let parsed = OcrService.parse(result.raw);
    if (!parsed && result.provider === "gvision") {
      // Vision devuelve texto plano; aquí podrías aplicar RegEx para números.
      parsed = { jugadas: [] };
    }
    const out = OcrService.toClient(parsed);

    // guarda en DB
    db && db.collection("ticketsOCR").insertOne({
      createdAt:   new Date(),
      provider:    result.provider,
      rawResponse: result.raw,
      parsed
    });

    return res.json({ success:true, provider:result.provider, resultado:out });

  } catch (err) {
    console.error("❌ OCR error:", err);
    return res.json({ success:false, error:err.message });
  }
});

/* ------------------------------------------------------------------
   ▸ 8. HOME + SERVER
--------------------------------------------------------------------*/
app.get("/", (_, res)=> res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, ()=> console.log(`🚀  Server on ${PORT}`));
