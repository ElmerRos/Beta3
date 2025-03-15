 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp");
const dayjs = require("dayjs"); // Asegúrate de tenerlo instalado

const app = express();

// 1) multer para almacenar en memoria
const upload = multer({ storage: multer.memoryStorage() });

// 2) Variables
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/db";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

let dbClient;
let db;

// 3) Conectarse a Mongo
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db(); // Usa el nombre de DB que tengas
    console.log("Conectado a MongoDB. Colección 'ticketsOCR' lista.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

// 4) Servir carpeta public
app.use(express.static("public"));

// 5) GET principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* 
   6) POST /ocr
     - Procesa la imagen con sharp
     - Envia payload a Mistral (SIN instructions)
     - Recoge la respuesta
     - Parseo local robusto
     - Guarda en Mongo
     - Devuelve JSON con la misma estructura que tu front-end espera
*/
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // A) Redimensionar
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // B) Convertir a base64
    const base64Str = resizedBuffer.toString("base64");
    let mimeType = "image/jpeg";
    if (req.file.mimetype === "image/png") {
      mimeType = "image/png";
    }

    // C) Payload para Mistral (SIN instructions, solo 'model' + 'document')
    const mistralPayload = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      }
    };

    // D) Llamar a la API
    const ocrResp = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      mistralPayload,
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const ocrData = ocrResp.data; 

    // E) Extraer texto y calcular confianza
    let textoCompleto = "";
    let allWords = [];
    let totalWords = 0;
    let sumConfidence = 0;

    if (Array.isArray(ocrData.pages)) {
      for (const page of ocrData.pages) {
        if (page.text_md) {
          textoCompleto += page.text_md + "\n";
        }
        if (Array.isArray(page.words_confidence)) {
          for (const w of page.words_confidence) {
            allWords.push(w);
            totalWords++;
            sumConfidence += (w.confidence || 0);
          }
        }
      }
    }
    const avgConfidence = totalWords > 0 ? (sumConfidence / totalWords) : 1;
    const avgConfidencePct = Math.round(avgConfidence * 100);

    // F) Parsear localmente, para obtener jugadas
    let lineas = textoCompleto
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    let jugadas = [];
    let camposDudosos = [];
    if (avgConfidencePct < 70) {
      camposDudosos.push("OCR < 70% => Requiere verificación");
    }

    // Función para parsear cada linea
    function parseTicketLine(line) {
      const lower = line.toLowerCase();

      // a) Montos en la linea
      const montoRegex = /(\d+(\.\d{1,2})?)/g;
      let montos = [];
      let mm;
      while ((mm = montoRegex.exec(line)) !== null) {
        montos.push(parseFloat(mm[1]));
      }

      // b) Detectar tipo juego por palabras clave
      let tipoJuego = "";
      if (lower.includes("peak3") || lower.includes("pick3") || lower.includes("pick 3")) tipoJuego = "Peak 3";
      else if (lower.includes("win4") || lower.includes("win 4")) tipoJuego = "Win 4";
      else if (lower.includes("venez")) tipoJuego = "Venezuela";
      else if (lower.includes("santo") || lower.includes("doming") || lower.includes("loteka") || lower.includes("nacional")) tipoJuego = "SantoDomingo";
      else if (lower.includes("pulito")) tipoJuego = "Pulito";
      else if (lower.includes("single")) tipoJuego = "SingleAction";

      // c) Modalidad: straight, box, combo, rounddown
      let modalidad = "";
      if (lower.includes("straight")) modalidad = "Straight";
      if (lower.includes("box")) modalidad = "Box";
      if (lower.includes("combo")) modalidad = "Combo";
      if (lower.includes("rounddown") || lower.includes("x")) modalidad = "RoundDown";

      // d) Detección dígitos 1-4 con X
      const numsRegex = /\b(\d{1,4}x?)\b/gi;
      let nums = [];
      let matchN;
      while ((matchN = numsRegex.exec(line)) !== null) {
        nums.push(matchN[1].toUpperCase());
      }

      // e) Si no hubo tipoJuego, lo deducimos por la longitud
      if (!tipoJuego && nums.length > 0) {
        const raw = nums[0].replace(/x/i, "");
        const len = raw.length;
        if (len === 1) tipoJuego = "SingleAction";
        if (len === 2) tipoJuego = "Pulito";
        if (len === 3) tipoJuego = "Peak 3";
        if (len === 4) tipoJuego = "Win 4";
      }

      // f) Asumir fecha = hoy
      let fecha = dayjs().format("YYYY-MM-DD");

      // g) Track => mid/ev
      let nowHHmm = dayjs().hour() * 100 + dayjs().minute();
      let track = (nowHHmm < 1415) ? "NY Midday" : "NY Evening";
      if (lower.includes("midday")) track = "NY Midday";
      if (lower.includes("evening") || lower.includes("eve")) track = "NY Evening";

      // h) Monto => primer valor o $1
      let monto = montos.length > 0 ? montos[0] : 1.00;
      if (monto > 200) {
        camposDudosos.push(`Monto elevado: ${monto}, linea: "${line}"`);
      }

      if (nums.length === 0) {
        return null; // No hay jugada
      }

      return {
        fecha,
        track,
        tipoJuego: tipoJuego || "desconocido",
        modalidad: modalidad || "desconocido",
        numeros: nums.join(","),
        montoApostado: parseFloat(monto.toFixed(2)),
        notas: ""
      };
    }

    for (const lin of lineas) {
      const jugada = parseTicketLine(lin);
      if (jugada) jugadas.push(jugada);
    }

    // G) Guardar en Mongo (opcional)
    await db.collection("ticketsOCR").insertOne({
      createdAt: new Date(),
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      avgConfidencePct,
      textCompleto,
      allWords,
      jugadas,
      camposDudosos,
      ocrRawResponse: ocrData
    });

    // H) Responder con la ESTRUCTURA que scripts.js espera
    return res.json({
      success: true,
      resultado: {
        textoCompleto,
        jugadas,
        camposDudosos
      },
      debug: {
        avgConfidencePct,
        totalWords,
        rawOcr: ocrData
      }
    });

  } catch (err) {
    console.error("Error en /ocr:", err.message);
    return res.json({ success: false, error: err.message });
  }
});

// 7) Iniciar server
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
