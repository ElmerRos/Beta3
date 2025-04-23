/**
 * services/ocrService.js
 * ------------------------------------------------------------------
 * Lógica OCR central:
 *   1. Intenta OpenAI Assistants V2  (modelo Vision)
 *   2. Fallback automático a Google Vision           (REST API key)
 *   3. Normaliza y enriquece resultado ➜  { jugadas, ticketInfo }
 *   4. Guarda miniatura 200×200 px + texto bruto en MongoDB (opcional)
 * ------------------------------------------------------------------
 */

"use strict";

/* ──────────────────────────────────────────────────────────────
 *  1 ▸ Dependencias
 * ──────────────────────────────────────────────────────────── */
const axios          = require("axios");
const FormData       = require("form-data");
const sharp          = require("sharp");
const { MongoClient } = require("mongodb");
const dayjs          = require("dayjs");

/* ──────────────────────────────────────────────────────────────
 *  2 ▸ Variables de entorno / Config
 * ──────────────────────────────────────────────────────────── */
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY   || "";
const OPENAI_ORG_ID    = process.env.OPENAI_ORG_ID    || "";
const ASSISTANT_ID     = process.env.ASSISTANT_ID     || "";
const GVISION_KEY      = process.env.GOOGLE_VISION_API_KEY || "";
const MONGODB_URI      = process.env.MONGODB_URI      || "";

if (!OPENAI_API_KEY || !ASSISTANT_ID) {
  console.error("❌ Falta OPENAI_API_KEY o ASSISTANT_ID");
  process.exit(1);
}

/* Mongo opcional */
let mongoDb = null;
(async () => {
  if (!MONGODB_URI) return;
  try {
    const cli = await new MongoClient(MONGODB_URI).connect();
    mongoDb = cli.db();
    console.log("✔ Mongo conectado (OCR logs)");
  } catch (err) {
    console.error("Mongo error:", err.message);
  }
})();

/* ──────────────────────────────────────────────────────────────
 *  3 ▸ Helpers genéricos
 * ──────────────────────────────────────────────────────────── */
const Api = {
  async call(cfg, retries = 3, delay = 1000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        return await axios(cfg);
      } catch (err) {
        lastErr = err;
        const again = !err.response || err.response.status >= 500;
        if (!again || i === retries - 1) break;
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw lastErr;
  },
  openaiHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Organization": OPENAI_ORG_ID,
      "OpenAI-Beta": "assistants=v2",
      ...extra,
    };
  },
};

/* ──────────────────────────────────────────────────────────────
 *  4 ▸ Prompt maestro (tomamos el mega‑prompt del usuario)
 * ──────────────────────────────────────────────────────────── */
function buildPrompt() {
  /*  Simplificamos: damos contexto resumido y reglas clave.
      Si quieres añadir TODO tu prompt completo, ponlo aquí. */
  return `
Eres un asistente experto en leer e interpretar tickets de lotería escritos a mano.
Extrae cada jugada y devuélvela en JSON con las claves:
  fecha, track, tipoJuego, modalidad, numeros, montoApostado, notas
Aplica las reglas:
  • Peak 3 = 3 dígitos, Win 4 = 4, Venezuela/RD/Pulito = 2 ó 4, SA = 1 dígito.
  • Straight/Box/Combo/RoundDown como se describe en la instrucción larga.
  • Si falta dato crítico, marca "esDudoso":true dentro de la jugada.
No verifiques premios; solo estructura la data. Devuelve:
{
 "jugadas":[{...}],
 "ticketInfo":{ "fecha":"", "track":"", "esDudoso":false }
}`;
}

/* ──────────────────────────────────────────────────────────────
 *  5 ▸ OpenAI Assistants  (upload → run → fetch)
 * ──────────────────────────────────────────────────────────── */
async function uploadFile(buffer, filename, mimetype) {
  const fd = new FormData();
  fd.append("purpose", "assistants");
  fd.append("file", buffer, { filename, contentType: mimetype });

  const res = await Api.call({
    method: "post",
    url: "https://api.openai.com/v1/files",
    headers: { ...Api.openaiHeaders(), ...fd.getHeaders() },
    data: fd,
  });

  return res.data.id;
}

async function createRun(fileId, prompt) {
  const res = await Api.call({
    method: "post",
    url: "https://api.openai.com/v1/threads/runs",
    headers: Api.openaiHeaders({ "Content-Type": "application/json" }),
    data: {
      assistant_id: ASSISTANT_ID,
      thread: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_file", image_file: { file_id: fileId } },
            ],
          },
        ],
      },
      response_format: { type: "json_object" },
    },
  });

  return { threadId: res.data.thread_id, runId: res.data.id, status: res.data.status };
}

async function waitForRun(threadId, runId, status) {
  const finalStates = new Set(["completed", "failed", "cancelled", "expired", "incomplete"]);
  while (!finalStates.has(status)) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await Api.call({
      method: "get",
      url: `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
      headers: Api.openaiHeaders(),
    });
    status = res.data.status;
  }
  return status;
}

async function fetchAssistantAnswer(threadId) {
  const res = await Api.call({
    method: "get",
    url: `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
    headers: Api.openaiHeaders(),
  });
  const msg = res.data.data.find(m => m.role === "assistant");
  if (!msg) throw new Error("Respuesta de assistant no encontrada");
  return msg.content?.[0]?.text?.value || "";
}

/* ──────────────────────────────────────────────────────────────
 *  6 ▸ Google Vision fallback  (REST API Key)
 * ──────────────────────────────────────────────────────────── */
async function visionOCR(buffer) {
  if (!GVISION_KEY) throw new Error("No hay GOOGLE_VISION_API_KEY");
  const b64 = buffer.toString("base64");
  const body = {
    requests: [
      {
        image: { content: b64 },
        features: [{ type: "TEXT_DETECTION" }],
      },
    ],
  };

  const res = await Api.call({
    method: "post",
    url: `https://vision.googleapis.com/v1/images:annotate?key=${GVISION_KEY}`,
    headers: { "Content-Type": "application/json" },
    data: body,
  });

  const text = res.data?.responses?.[0]?.fullTextAnnotation?.text || "";
  return text;
}

/* ──────────────────────────────────────────────────────────────
 *  7 ▸ Miniatura 200×200 px  (para Mongo)
 * ──────────────────────────────────────────────────────────── */
async function createThumbnail(buffer) {
  return sharp(buffer).resize(200, 200, { fit: "inside" }).jpeg({ quality: 60 }).toBuffer();
}

/* ──────────────────────────────────────────────────────────────
 *  8 ▸ Post‑procesado y utilidades de parseo
 *      (muy básico: guión 23‑5   → número 23  straight 5 )
 * ──────────────────────────────────────────────────────────── */
function safeJSON(text) {
  try { return typeof text === "string" ? JSON.parse(text) : text; }
  catch { return null; }
}

function guionToStraight(j) {
  if (j.numeros?.includes("-")) {
    const [num, monto] = j.numeros.split("-");
    const val = parseFloat((monto || "").replace(/[^0-9.]/g, ""));
    if (!isNaN(val) && (!j.montoApostado || j.montoApostado === 0)) {
      j.numeros = num.trim();
      j.montoApostado = val;
      j.modalidad = j.modalidad || "Straight";
    }
  }
  return j;
}

function normalizeAssistantObj(ast) {
  if (!ast?.jugadas) return { jugadas: [] };

  const jugadas = ast.jugadas.map(j => {
    j = guionToStraight({ ...j });
    /* default fields */
    j.straight = j.straight || 0;
    j.box      = j.box      || 0;
    j.combo    = j.combo    || 0;
    j.esDudoso = !!j.esDudoso;
    return j;
  });

  return {
    jugadas,
    ticketInfo: {
      fecha: ast.ticketInfo?.fecha || "",
      track: ast.ticketInfo?.track || "",
      esDudoso: !!ast.ticketInfo?.esDudoso,
    },
  };
}

/* ──────────────────────────────────────────────────────────────
 *  9 ▸ Servicio público – processImage
 * ──────────────────────────────────────────────────────────── */
async function processImage({ buffer, mimetype, originalname }) {
  const startTs = Date.now();
  /* Para debug y logging */
  const logDoc = {
    originalname,
    createdAt: new Date(),
    metodo: "",
    tiempoMs: 0,
    resultado: null,
    debug: {},
  };

  try {
    /* ---------- ① OpenAI --------------- */
    const fileId  = await uploadFile(buffer, originalname, mimetype);
    const prompt  = buildPrompt();
    const { threadId, runId, status } = await createRun(fileId, prompt);
    const finalSt = await waitForRun(threadId, runId, status);

    if (finalSt !== "completed") throw new Error(`Run ${finalSt}`);

    const rawText = await fetchAssistantAnswer(threadId);
    const parsed  = safeJSON(rawText);
    if (!parsed) throw new Error("JSON inválido OpenAI");

    const resultado = normalizeAssistantObj(parsed);

    logDoc.metodo   = "openai";
    logDoc.tiempoMs = Date.now() - startTs;
    logDoc.resultado= resultado;
    logDoc.debug    = { threadId, runId };

    await saveToMongo(buffer, logDoc);

    return { metodo: "openai", resultado, debug: logDoc.debug };
  } catch (err) {
    console.warn("⚠️  OpenAI falló → Vision fallback:", err.message);
    /* ---------- ② Google Vision fallback --------------- */
    const textRaw   = await visionOCR(buffer);
    const jugadas   = parseSimpleVision(textRaw);   // heurística rápida
    const resultado = normalizeAssistantObj({ jugadas, ticketInfo: {} });

    logDoc.metodo   = "vision";
    logDoc.tiempoMs = Date.now() - startTs;
    logDoc.resultado= resultado;
    logDoc.debug    = { textRaw };

    await saveToMongo(buffer, logDoc);

    return { metodo: "vision", resultado, debug: logDoc.debug };
  }
}

/* Heurística mínima para Vision */
function parseSimpleVision(text) {
  const jugadas = [];
  text.split(/\n+/).forEach(l => {
    const m = l.match(/^(\d{2,4})\s*[- ]\s*(\d+(?:\.\d+)?)/);
    if (m) {
      jugadas.push({
        numeros: m[1],
        montoApostado: parseFloat(m[2]),
        tipoJuego: m[1].length === 3 ? "Peak 3" : m[1].length === 4 ? "Win 4" : "Desconocido",
        modalidad: "Straight",
      });
    }
  });
  return jugadas;
}

/* Guarda en Mongo (miniatura + texto bruto opcional) */
async function saveToMongo(imgBuffer, logDoc) {
  if (!mongoDb) return;
  try {
    const thumb = await createThumbnail(imgBuffer);
    logDoc.thumbnail = thumb.toString("base64");        // base64 inline
    await mongoDb.collection("ocrLogs").insertOne(logDoc);
  } catch (e) {
    console.error("Mongo insert error:", e.message);
  }
}

/* ──────────────────────────────────────────────────────────────
 *  10 ▸ Export
 * ──────────────────────────────────────────────────────────── */
module.exports = { processImage };
