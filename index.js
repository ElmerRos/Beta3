 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp");

const app = express();

// Multer: almacenamiento en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@host/db";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "API_KEY_MISTRAL";

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

// Servir estáticos
app.use(express.static("public"));

// GET /
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * POST /ocr
 * - Se sube una imagen de ticket manuscrito
 * - Se reescala opcionalmente (sharp)
 * - Se convierte en base64
 * - Se manda a Mistral (type = "image_url", image_url = data:...)
 * - Se parsea el JSON
 * - Se guarda en MongoDB
 */
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({
      success: false,
      error: "No se recibió ninguna imagen."
    });
  }

  try {
    // Redimensionar la imagen a 2000x2000 (opcional)
    let resizedBuffer = await sharp(req.file.buffer)
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside"
      })
      // .toFormat("png") // opcional, si quieres forzar PNG
      .toBuffer();

    // Convertir a base64
    const base64Str = resizedBuffer.toString("base64");

    // Determinar mimeType (png o jpeg)
    let mimeType = "image/png";
    if (req.file.mimetype === "image/jpeg") {
      mimeType = "image/jpeg";
    }

    // Armar el body para Mistral OCR
    // => doc oficial sugiere:
    // {
    //   "model": "mistral-ocr-latest",
    //   "document": {
    //     "type": "image_url",
    //     "image_url": "data:image/png;base64,<BASE64>"
    //   }
    // }
    const mistralBody = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      }
    };

    // Llamar a la API de Mistral
    const ocrResp = await axios.post("https://api.mistral.ai/v1/ocr", mistralBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`
      }
    });

    // ocrResp.data podría tener "pages" etc.
    const ocrData = ocrResp.data;

    // Extrae texto / confianza
    // Dependiendo de la doc, a veces viene en:
    // ocrData.document.pages => array de { text_md, words_confidence, ... }
    // Ajustar según la respuesta real
    let pages = ocrData.document?.pages || [];
    // Concatena el texto
    let fullText = "";
    let totalWords = 0;
    let sumConfidence = 0;

    pages.forEach((page) => {
      if (page.text_md) {
        fullText += page.text_md + "\n";
      }
      if (Array.isArray(page.words_confidence)) {
        page.words_confidence.forEach((w) => {
          totalWords++;
          sumConfidence += w.confidence || 0;
        });
      }
    });

    let avgConfidence = totalWords > 0 ? sumConfidence / totalWords : 1;

    // Por ejemplo, parse heurístico
    let lineas = fullText.split("\n").map(l => l.trim()).filter(Boolean);
    let jugadas = [];
    let camposDudosos = [];
    if (avgConfidence < 0.75) {
      camposDudosos = ["fecha","track","tipoJuego","modalidad","numeros","montoApostado"];
    }

    lineas.forEach(line => {
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
      // "detectar" datos (lógica de ejemplo):
      // ...
      jugadas.push(jug);
    });

    // Guardar en DB
    await db.collection("ticketsOCR").insertOne({
      createdAt: new Date(),
      fullText,
      avgConfidence,
      jugadas
    });

    // Devolver JSON
    return res.json({
      success: true,
      resultado: { jugadas, camposDudosos }
    });
  } catch (err) {
    // Logs detallados
    console.error("Error en /ocr:", err.message);
    console.error("Error response data:", JSON.stringify(err.response?.data, null, 2));

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
