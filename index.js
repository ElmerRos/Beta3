 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp");
const dayjs = require("dayjs");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// -- Variables de entorno / Config --
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/dbName";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

let dbClient;
let db;

// Conectar a Mongo
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db();
    console.log("Conectado a MongoDB. Colección 'ticketsOCR'.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

// Servir la carpeta 'public'
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =============================================================
// Ruta POST /ocr
// =============================================================
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // 1) Redimensionar con sharp
    console.log("---- /ocr ----");
    console.log("Imagen recibida:", req.file.originalname, "size:", req.file.size);

    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();
    console.log("Imagen redimensionada. Buffer length:", resizedBuffer.length);

    // 2) Convertir a Base64
    const base64Str = resizedBuffer.toString("base64");
    let mimeType = "image/jpeg";
    if (req.file.mimetype === "image/png") {
      mimeType = "image/png";
    }
    console.log(`MimeType detectado: ${mimeType}, base64 length: ${base64Str.length}`);

    // 3) Construir payload para Mistral (SIN instructions, para evitar 422)
    const mistralPayload = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      }
    };

    // 4) Llamar a Mistral OCR
    console.log("Enviando payload a Mistral...");
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

    const ocrData = ocrResp.data; // Respuesta cruda de Mistral
    console.log("Respuesta Mistral recibida OK.");

    // 5) Extraer texto y calcular confianza
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

    console.log("Texto Completo (preview):", textoCompleto.slice(0, 100).replace(/\n/g,"\\n"), "...");
    console.log("Promedio Confianza:", avgConfidence, "(~", avgConfidencePct + "% )");
    console.log("Total words:", totalWords);

    // 6) Parseo local => Generar 'jugadas'
    let lineas = textoCompleto
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    let jugadas = [];
    let camposDudosos = [];

    if (avgConfidencePct < 70) {
      camposDudosos.push("Confianza OCR < 70% => verificación manual");
    }

    function parseLineToJugada(line) {
      const lower = line.toLowerCase();

      // Montos
      const montoRegex = /(\d+(\.\d{1,2})?)/g;
      let montos = [];
      let mm;
      while ((mm = montoRegex.exec(line)) !== null) {
        montos.push(parseFloat(mm[1]));
      }

      // TipoJuego
      let tipoJuego = "";
      if (lower.includes("pick3") || lower.includes("peak3")) tipoJuego = "Peak 3";
      else if (lower.includes("win4")) tipoJuego = "Win 4";
      else if (lower.includes("venez")) tipoJuego = "Venezuela";
      else if (lower.includes("santo") || lower.includes("doming") || lower.includes("loteka")) tipoJuego = "SantoDomingo";
      else if (lower.includes("pulito")) tipoJuego = "Pulito";
      else if (lower.includes("single")) tipoJuego = "SingleAction";

      // Modalidad
      let modalidad = "";
      if (lower.includes("straight")) modalidad = "Straight";
      if (lower.includes("box")) modalidad = "Box";
      if (lower.includes("combo")) modalidad = "Combo";
      if (lower.includes("rounddown") || lower.includes(" x")) modalidad = "RoundDown";

      // Detectar dígitos
      const numsRegex = /\b(\d{1,4}x?)\b/gi;
      let nums = [];
      let matchN;
      while ((matchN = numsRegex.exec(line)) !== null) {
        nums.push(matchN[1].toUpperCase());
      }

      // Deducir tipoJuego si no se ve
      if (!tipoJuego && nums.length > 0) {
        const raw = nums[0].replace(/x/i, "");
        if (raw.length === 1) tipoJuego = "SingleAction";
        if (raw.length === 2) tipoJuego = "Pulito";
        if (raw.length === 3) tipoJuego = "Peak 3";
        if (raw.length === 4) tipoJuego = "Win 4";
      }

      // Fecha => hoy
      let fecha = dayjs().format("YYYY-MM-DD");

      // Track => Midday / Evening según hora
      let nowHHmm = dayjs().hour() * 100 + dayjs().minute();
      let track = (nowHHmm < 1415) ? "NY Midday" : "NY Evening";
      if (lower.includes("midday")) track = "NY Midday";
      if (lower.includes("evening") || lower.includes("eve")) track = "NY Evening";

      // Monto => primer match o $1
      let monto = montos.length > 0 ? montos[0] : 1.00;
      if (monto > 200) {
        camposDudosos.push(`Monto elevado: ${monto}, línea: "${line}"`);
      }

      if (nums.length === 0) {
        return null; // no jugada
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
      const jugada = parseLineToJugada(lin);
      if (jugada) jugadas.push(jugada);
    }

    // 7) Guardar en Mongo (opcional)
    const docToInsert = {
      createdAt: new Date(),
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      avgConfidencePct,
      textoCompleto,
      allWords,
      jugadas,
      camposDudosos,
      ocrRawResponse: ocrData
    };
    await db.collection("ticketsOCR").insertOne(docToInsert);

    console.log("Jugadas detectadas:", jugadas.length);
    console.log("Campos dudosos:", camposDudosos);

    // 8) Devolver respuesta con la ESTRUCTURA que tu scripts.js espera
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos
      },
      debug: {
        avgConfidencePct,
        totalWords,
        textoCompleto,
        rawOcr: ocrData
      }
    });

  } catch (err) {
    console.error("Error en /ocr:", err.message);
    return res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
