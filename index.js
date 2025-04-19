 "use strict";

// Las variables de entorno serán proporcionadas por el entorno de despliegue (ej. Render)
// No se necesita dotenv.config()

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
const { MongoClient } = require("mongodb");
const dayjs = require("dayjs");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- Middlewares para parsear JSON y form-url-encoded ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ajusta según tu entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/dbName";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ASSISTANT_ID = process.env.ASSISTANT_ID || "";        // Se debe configurar en Render
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID || "";      // Opcional

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Falta OPENAI_API_KEY o ASSISTANT_ID. No se puede arrancar.");
  process.exit(1);
}

// --- Cliente API con reintentos ---
const ApiClient = {
  async request(config, retries = 3, initialDelay = 1000) {
    let lastError, delay = initialDelay;
    for (let i = 0; i < retries; i++) {
      try {
        return await axios(config);
      } catch (err) {
        lastError = err;
        const shouldRetry = !err.response || err.response.status >= 500;
        if (!shouldRetry || i === retries - 1) break;
        console.log(`Reintento ${i+1}/${retries} tras error: ${err.message}, esperando ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw lastError;
  },
  getOpenAIHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "assistants=v2",
      "OpenAI-Organization": OPENAI_ORG_ID,
      ...extra
    };
  }
};

// --- Servicio de OCR (redimensiona, sube, genera prompt y consulta) ---
const OcrService = {
  async resizeImage(buffer) {
    return sharp(buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();
  },
  async uploadFileToOpenAI(buffer, filename, mimetype) {
    const form = new FormData();
    form.append("purpose", "assistants");
    form.append("file", buffer, { filename, contentType: mimetype });
    const resp = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/files",
      data: form,
      headers: {
        ...ApiClient.getOpenAIHeaders(),
        ...form.getHeaders()
      }
    });
    return resp.data.id;
  },
  getDetailedPrompt(serverTime) {
    const formatted = serverTime.format("YYYY-MM-DD HH:mm:ss Z");
    return `Por favor, analiza la imagen adjunta ... La hora actual del servidor es ${formatted}. Devuelve SOLO JSON válido con la estructura ...`;
    // (aquí va todo tu prompt detallado tal cual lo tenías)
  },
  async createAndRunAssistant(fileId, prompt) {
    const resp = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/threads/runs",
      headers: ApiClient.getOpenAIHeaders({ "Content-Type": "application/json" }),
      data: {
        assistant_id: ASSISTANT_ID,
        thread: { messages: [{ role: "user", content: [ { type: "text", text: prompt }, { type: "image_file", image_file: { file_id: fileId } } ] }] },
        response_format: { type: "json_object" }
      }
    });
    return { threadId: resp.data.thread_id, runId: resp.data.id, initialStatus: resp.data.status };
  },
  async pollRunStatus(threadId, runId, status) {
    const final = new Set(["completed","failed","incomplete","cancelled","expired"]);
    while (!final.has(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const resp = await ApiClient.request({
        method: "get",
        url: `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        headers: ApiClient.getOpenAIHeaders()
      });
      status = resp.data.status;
    }
    return status;
  },
  async getAssistantResponse(threadId) {
    const resp = await ApiClient.request({
      method: "get",
      url: `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      headers: ApiClient.getOpenAIHeaders()
    });
    const msg = resp.data.data.find(m => m.role === "assistant");
    if (!msg) throw new Error("No se encontró respuesta del assistant");
    return msg.content;
  },
  parseAssistantResponse(raw) {
    try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
    catch (e) { return null; }
  },
  transformResponseForClient(parsed) {
    if (!parsed || !Array.isArray(parsed.jugadas)) return { jugadas: [] };
    const jugadas = parsed.jugadas.map((j, i) => {
      const monto = (j.straight||0)+(j.box||0)+(j.combo||0);
      const out = { numeros: j.numero||"", montoApostado: monto, straight: j.straight||0, box: j.box||0, combo: j.combo||0 };
      if (j.esNumeroDudoso||j.esMontoDudoso||j.esTipoJuegoDudoso||j.esModalidadDudosa) {
        out.esDudoso = true;
        out.detallesDudas = {
          numero: !!j.esNumeroDudoso,
          monto: !!j.esMontoDudoso,
          tipoJuego: !!j.esTipoJuegoDudoso,
          modalidad: !!j.esModalidadDudosa
        };
      }
      return out;
    });
    const info = parsed.ticketInfo || {};
    return { jugadas, ticketInfo: { fecha: info.fecha||"", track: info.track||"", esDudoso: info.esFechaDudosa||info.esTrackDudoso||false } };
  }
};

// --- Conexión a MongoDB ---
let db = null;
(async () => {
  try {
    const client = await new MongoClient(MONGODB_URI, { useUnifiedTopology: true }).connect();
    db = client.db();
    console.log("✅ Conectado a MongoDB");
  } catch (e) {
    console.error("❌ Error conectando a MongoDB:", e);
  }
})();

// --- Rutas y estáticos ---
app.use(express.static("public"));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Ruta principal de OCR
app.post("/ocr", upload.single("ticket"), async (req, res, next) => {
  res.type("application/json");  // <-- forzamos JSON
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No se recibió ninguna imagen." });

    const serverTime = dayjs();
    const resized = await OcrService.resizeImage(req.file.buffer);
    const fileId  = await OcrService.uploadFileToOpenAI(resized, req.file.originalname, req.file.mimetype);
    const prompt  = OcrService.getDetailedPrompt(serverTime);
    const { threadId, runId, initialStatus } = await OcrService.createAndRunAssistant(fileId, prompt);
    const finalStatus = await OcrService.pollRunStatus(threadId, runId, initialStatus);
    if (finalStatus !== "completed") {
      return res.json({ success: false, error: `OCR terminó con estado: ${finalStatus}` });
    }

    const raw    = await OcrService.getAssistantResponse(threadId);
    const parsed = OcrService.parseAssistantResponse(raw);
    if (!parsed) return res.json({ success: false, error: "No se pudo parsear la respuesta del OCR" });

    const resultado = OcrService.transformResponseForClient(parsed);
    if (db) {
      await db.collection("ticketsOCR").insertOne({
        createdAt: new Date(),
        serverTime: serverTime.toISOString(),
        rawAssistantOutput: raw,
        parsedResponse: parsed,
        resultado
      });
    }

    return res.json({ success: true, resultado, debug: { runId, threadId, rawOcr: raw } });

  } catch (err) {
    // si algo falla, pasa al manejador global
    next(err);
  }
});

// --- Manejador global de errores: siempre devuelve JSON ---
app.use((err, req, res, next) => {
  console.error("💥 Error no controlado:", err);
  res.status(500).json({ success: false, error: err.message || "Error interno del servidor" });
});

// --- Iniciar servidor ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
