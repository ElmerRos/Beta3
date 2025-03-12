 /***********************************************************
 * index.js - App OCR con Mistral + redimensionado opcional
 * 
 * 1) Servir front-end desde carpeta "public"
 * 2) POST /ocr => sube imagen a Mistral en formato data:image/png;base64
 * 3) Guarda info en MongoDB (colección ticketsOCR)
 * 4) Manejo de logs para ver error 422 completo
 ***********************************************************/
"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp"); // Para redimensionar opcionalmente

const app = express();

// Manejo de archivo en memoria con multer
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@host/db";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

// Conexión a MongoDB
let dbClient;
let db;
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db();
    console.log("Conectado a MongoDB Atlas. Colección 'ticketsOCR' se creará al insertar.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

/************************************************************
 * Servir archivos estáticos (index.html, scripts.js, styles.css, etc.)
 ************************************************************/
app.use(express.static("public"));

/************************************************************
 * GET "/" - Sirve el archivo index.html
 ************************************************************/
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/************************************************************
 * POST /ocr
 * 1) Redimensiona (opcional) la imagen con Sharp
 * 2) Convierte a base64
 * 3) Envía a Mistral AI como data URL => "type": "image_url"
 * 4) Parsea response => avgConfidence, etc.
 * 5) Guarda en "ticketsOCR"
 ************************************************************/
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // 1) (OPCIONAL) Redimensionar la imagen a 2000x2000 máx
    let resizedBuffer = await sharp(req.file.buffer)
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside"
      })
      // .toFormat("png")  // (si quieres forzar PNG)
      .toBuffer();

    // 2) Convertir a base64
    const base64Str = resizedBuffer.toString("base64");

    // Determinar MIME type según lo que subió el usuario (por defecto PNG)
    let mimeType = "image/png";
    if (req.file.mimetype === "image/jpeg") {
      mimeType = "image/jpeg";
    }

    // 3) Armar request a Mistral con la estructura recomendada
    //    "documents": [ { type: "image_url", document_url: "data:image/png;base64,..." } ]
    const mistralReq = {
      model: "mistral-ocr-latest",
      documents: [
        {
          type: "image_url",
          document_url: `data:${mimeType};base64,${base64Str}`
        }
      ]
    };

    // 4) Llamar a Mistral
    const ocrResp = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      mistralReq,
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const ocrData = ocrResp.data;

    // 4a) Acceder a la primera respuesta => documents[0].pages
    let pages = [];
    if (
      ocrData.documents &&
      Array.isArray(ocrData.documents) &&
      ocrData.documents.length > 0 &&
      Array.isArray(ocrData.documents[0].pages)
    ) {
      pages = ocrData.documents[0].pages;
    }

    // Unir texto + calcular confianza
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;

    pages.forEach((page) => {
      if (page.text_md) {
        textoCompleto += page.text_md + "\n";
      }
      if (page.words_confidence && Array.isArray(page.words_confidence)) {
        page.words_confidence.forEach((w) => {
          totalWords++;
          sumConfidence += w.confidence || 0;
        });
      }
    });

    let avgConfidence = totalWords > 0 ? sumConfidence / totalWords : 1;

    // 4b) Parse heurístico
    let lineas = textoCompleto.split("\n").map(l => l.trim()).filter(Boolean);
    let jugadas = [];
    let camposDudosos = [];

    if (avgConfidence < 0.75) {
      camposDudosos = ["fecha","track","tipoJuego","modalidad","numeros","montoApostado"];
    }

    lineas.forEach(line => {
      const lower = line.toLowerCase();
      let jug = {
        fecha: null,
        track: null,
        tipoJuego: null,
        modalidad: null,
        numeros: null,
        montoApostado: null,
        notas: "",
        confianza: avgConfidence
      };

      // Detección muy simplificada de tipo de juego
      if (lower.includes("pick3")) {
        jug.tipoJuego = "Pick 3";
      } else if (lower.includes("win4")) {
        jug.tipoJuego = "Win 4";
      } else if (lower.includes("venez")) {
        jug.tipoJuego = "Venezuela";
      } else if (lower.includes("doming")) {
        jug.tipoJuego = "SantoDomingo";
      } else if (lower.includes("pulito")) {
        jug.tipoJuego = "Pulito";
      } else if (lower.includes("single")) {
        jug.tipoJuego = "SingleAction";
      } else {
        jug.tipoJuego = "desconocido";
      }

      // Modalidad
      if (lower.includes("combo")) jug.modalidad = "Combo";
      else if (lower.includes("box")) jug.modalidad = "Box";
      else if (lower.includes("straight")) jug.modalidad = "Straight";
      else if (lower.includes("round") || lower.includes("x")) jug.modalidad = "RoundDown";
      else jug.modalidad = "desconocido";

      // Números (ejemplo: 2 o 4 dígitos, con o sin 'X')
      let rgxNums = /\b(\d{2,4}X|\d{2,4})\b/g;
      let matches = line.match(rgxNums);
      if (matches && matches.length > 0) {
        jug.numeros = matches.join(",");
      } else {
        jug.numeros = "ilegible";
      }

      // Monto apostado (ejemplo "$5" o "7.50")
      let rgxMonto = /\$?\d+(\.\d{1,2})?/;
      let mm = line.match(rgxMonto);
      if (mm) {
        let mStr = mm[0].replace("$","");
        jug.montoApostado = parseFloat(mStr);
      } else {
        jug.montoApostado = "?";
      }

      jugadas.push(jug);
    });

    // fallback de fecha y track
    const now = new Date();
    const isoHoy = now.toISOString().slice(0,10);
    const hora = now.getHours() + now.getMinutes()/60;
    jugadas.forEach(j => {
      if (!j.fecha) {
        j.fecha = isoHoy;
      }
      if (!j.track) {
        j.track = (hora < 14.25) ? "NY Midday" : "NY Evening";
      }
    });

    // 5) Guardar en DB
    const col = db.collection("ticketsOCR");
    await col.insertOne({
      createdAt: new Date(),
      fullText: textoCompleto,
      avgConfidence,
      jugadas
    });

    // Responder al front
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos
      }
    });

  } catch (err) {
    // Log detallado: ver en Render Logs el "mensaje" y el body JSON
    console.error("Error en /ocr:", err.message);
    console.error("Error response data:", JSON.stringify(err.response?.data, null, 2));

    // Mistral a veces manda un JSON con { error: "...", message: "..." }
    return res.status(500).json({
      success: false,
      error: err.response?.data?.error || err.message
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
