 /*  index.js – versión optimizada 19‑abr‑2025
    Principales mejoras (no técnicas):
    • Procesa las imágenes más rápido y baratas.
    • Mensajes de error comprensibles.
    • Barra de progreso real (el cliente recibe porcentajes).
    • Limpia archivos temporales y cuida la base de datos.
    • Comprueba variables de entorno al arrancar.
*/

"use strict";

const path           = require("path");
const express        = require("express");
const multer         = require("multer");
const axios          = require("axios");
const FormData       = require("form-data");
const sharp          = require("sharp");
const { MongoClient }= require("mongodb");
const dayjs          = require("dayjs");

////////////////////////////////////////////////////////////////////////////////
// 1. Configuración y comprobaciones básicas
////////////////////////////////////////////////////////////////////////////////

const PORT          = process.env.PORT;
const MONGODB_URI   = process.env.MONGODB_URI;
const OPENAI_API_KEY= process.env.OPENAI_API_KEY;
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID || "";   // opcional
const ASSISTANT_ID  = process.env.ASSISTANT_ID  || "asst_iPQIGQRDCf1YeQ4P3p9ued6W";

function ensureEnv(varName, value) {
  if (!value) {
    console.error(`❌ Falta la variable de entorno ${varName}. No se puede arrancar.`);
    process.exit(1);
  }
}
["PORT","MONGODB_URI","OPENAI_API_KEY","ASSISTANT_ID"].forEach(v => ensureEnv(v, process.env[v]));

////////////////////////////////////////////////////////////////////////////////
// 2. Servidor Express
////////////////////////////////////////////////////////////////////////////////

const app = express();

// límites básicos de seguridad: 8 MB por imagen
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits : { fileSize: 8 * 1024 * 1024 } 
});

// Servir la carpeta public
app.use(express.static("public"));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname,"public","index.html")));

////////////////////////////////////////////////////////////////////////////////
// 3. Cliente HTTP con reintentos automáticos
////////////////////////////////////////////////////////////////////////////////

const ApiClient = {
  async request(cfg, retries = 3, delay = 1000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        return await axios(cfg);
      } catch (err) {
        lastErr = err;
        const retriable = !err.response || err.response.status >= 500;
        if (!retriable || i === retries - 1) break;
        console.log(`⚠️  Reintento ${i+1}/${retries} en ${delay} ms... (${err.message})`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw lastErr;
  },
  openAIHeaders(extra = {}) {
    return {
      "Authorization"    : `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta"      : "assistants=v2",
      "OpenAI-Organization": OPENAI_ORG_ID,
      ...extra
    };
  }
};

////////////////////////////////////////////////////////////////////////////////
// 4. Funciones OCR / OpenAI
////////////////////////////////////////////////////////////////////////////////

const OCR = {

  /* 4.1 Redimensionar y comprimir (calidad 80, escala de grises) */
  async optimise(buffer) {
    return sharp(buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .grayscale()
      .jpeg({ quality: 80 })
      .toBuffer();
  },

  /* 4.2 Subir la imagen a OpenAI */
  async upload(buffer, filename) {
    const fd = new FormData();
    fd.append("purpose","assistants");
    fd.append("file", buffer, { filename, contentType: "image/jpeg" });

    const { data } = await ApiClient.request({
      method : "post",
      url    : "https://api.openai.com/v1/files",
      data   : fd,
      headers: { ...ApiClient.openAIHeaders(), ...fd.getHeaders() }
    });
    return data.id;                  // ← file_id
  },

  /* 4.3 Prompt detallado (verbal, con hora del servidor) */
  prompt(now) {
    const stamp = now.format("YYYY-MM-DD HH:mm:ss Z");
    return `La hora del servidor es ${stamp}. ...
(Se mantiene el mismo prompt detallado que ya tenías aquí, sin cambios)`;
  },

  /* 4.4 Crear hilo+run */
  async createRun(fileId, prompt) {
    const { data } = await ApiClient.request({
      method : "post",
      url    : "https://api.openai.com/v1/threads/runs",
      data   : {
        assistant_id: ASSISTANT_ID,
        thread: {
          messages: [{
            role: "user",
            content: [
              { type:"text", text: prompt },
              { type:"image_file", image_file:{ file_id:fileId } }
            ]
          }]
        },
        response_format: { type:"json_object" }
      },
      headers: { ...ApiClient.openAIHeaders(), "Content-Type":"application/json" }
    });
    return { threadId: data.thread_id, runId:data.id, status:data.status };
  },

  /* 4.5 Esperar hasta que el run termine (polling) */
  async waitRun(threadId, runId, status, updateProgress) {
    const done = new Set(["completed","failed","incomplete","cancelled","expired"]);
    while (!done.has(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const { data } = await ApiClient.request({
        method : "get",
        url    : `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        headers: ApiClient.openAIHeaders()
      });
      status = data.status;
      updateProgress(60);            // ≈ progreso medio mientras espera
    }
    return status;
  },

  /* 4.6 Obtener la respuesta */
  async fetchAnswer(threadId) {
    const { data } = await ApiClient.request({
      method : "get",
      url    : `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      headers: ApiClient.openAIHeaders()
    });
    const msg = data.data.find(m => m.role==="assistant");
    if (!msg) throw new Error("No se encontró respuesta del assistant");
    return msg.content;
  },

  /* 4.7 Borrar archivo remoto (ahorra espacio y costes) */
  async deleteFile(fileId) {
    try {
      await ApiClient.request({
        method : "delete",
        url    : `https://api.openai.com/v1/files/${fileId}`,
        headers: ApiClient.openAIHeaders()
      });
    } catch (e) { console.warn("No se pudo borrar fileId:", fileId); }
  },

  /* 4.8 Parseo seguro a JSON */
  parse(raw) {
    const tryJson = str => { try { return JSON.parse(str); } catch { return null; } };

    if (Array.isArray(raw)) {
      const t = raw.find(p => p.type==="text")?.text?.value;
      return t ? tryJson(t) : null;
    }
    if (typeof raw === "string") return tryJson(raw);
    if (raw?.type==="text")      return tryJson(raw.text?.value);
    return null;
  },

  /* 4.9 Transformar a formato amigable */
  toClient(parsed) {
    if (!parsed?.jugadas) return { jugadas: [] };

    const jugadas = parsed.jugadas.map(j => {
      const total   = (j.straight||0)+(j.box||0)+(j.combo||0);
      const obj = {
        numeros: j.numero || "",
        montoApostado: total,
        straight: j.straight||0,
        box     : j.box||0,
        combo   : j.combo||0
      };
      if (j.esNumeroDudoso || j.esMontoDudoso || j.esTipoJuegoDudoso || j.esModalidadDudosa) {
        obj.esDudoso = true;
      }
      return obj;
    });

    const ticketInfo = parsed.ticketInfo && {
      fecha   : parsed.ticketInfo.fecha,
      track   : parsed.ticketInfo.track,
      esDudoso: parsed.ticketInfo.esFechaDudosa || parsed.ticketInfo.esTrackDudoso
    };

    return { jugadas, ticketInfo };
  }
};

////////////////////////////////////////////////////////////////////////////////
// 5. MongoDB (conexión única global)
////////////////////////////////////////////////////////////////////////////////

let db;
(async () => {
  try {
    const client = await new MongoClient(MONGODB_URI, { useUnifiedTopology:true }).connect();
    db = client.db();
    console.log("✅ Conectado a MongoDB.");
  } catch(e) {
    console.error("❌ Error conectando a MongoDB:", e.message);
  }
})();

////////////////////////////////////////////////////////////////////////////////
// 6. Ruta principal /ocr  (con barra de progreso)
////////////////////////////////////////////////////////////////////////////////

app.post("/ocr", upload.single("ticket"), async (req, res) => {

  // 6.1 Función auxiliar para enviar progreso parcial
  const steps = { VALIDA:5, REDUCE:15, SUBE:25, RUN:60, PARSEA:80, LISTO:100 };
  const progress = p => {
    res.write(`data: ${p}\n\n`);    // Server‑Sent Events (SSE)
  };

  // 6.2 Cabeceras SSE – permite que el frontend actualice la barra en vivo
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  try {
    if (!req.file) throw new Error("No se recibió ninguna imagen.");
    progress(steps.VALIDA);

    const now = dayjs();
    const optimised = await OCR.optimise(req.file.buffer);
    progress(steps.REDUCE);

    const fileId = await OCR.upload(optimised, req.file.originalname || "ticket.jpg");
    progress(steps.SUBE);

    const { threadId, runId, status } = await OCR.createRun(fileId, OCR.prompt(now));
    const finalStatus = await OCR.waitRun(threadId, runId, status, progress);

    if (finalStatus !== "completed") {
      throw new Error(`El análisis terminó con estado: ${finalStatus}`);
    }
    progress(steps.RUN);

    const raw = await OCR.fetchAnswer(threadId);
    const parsed = OCR.parse(raw);
    if (!parsed) throw new Error("No se entendió la respuesta del assistant.");
    progress(steps.PARSEA);

    const resultado = OCR.toClient(parsed);

    // Guardar sólo lo útil en Mongo
    if (db) {
      await db.collection("ticketsOCR").insertOne({
        createdAt : new Date(),
        raw       : raw,        // para auditoría
        resultado
      });
    }

    // Limpiar archivo remoto
    OCR.deleteFile(fileId).catch(()=>{});

    progress(steps.LISTO);
    res.write(`event: close\ndata: ${JSON.stringify({ success:true, resultado })}\n\n`);
    res.end();

  } catch (err) {
    console.error("❌ /ocr:", err.message);
    progress(100);
    res.write(`event: close\ndata: ${JSON.stringify({ success:false, error: err.message })}\n\n`);
    res.end();
  }
});

////////////////////////////////////////////////////////////////////////////////
// 7. Arranque del servidor
////////////////////////////////////////////////////////////////////////////////

app.listen(Number(PORT), () => {
  console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});
