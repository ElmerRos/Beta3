 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp");

const app = express();

// Configuración de multer para almacenar archivos en memoria
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

// Servir archivos estáticos desde la carpeta "public"
app.use(express.static("public"));

// Ruta GET para la página principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Ruta POST para procesar OCR
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // Redimensionar la imagen a un máximo de 2000x2000 píxeles
    let resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // Convertir la imagen a base64
    const base64Str = resizedBuffer.toString("base64");

    // Determinar el tipo MIME de la imagen
    let mimeType = "image/png";
    if (req.file.mimetype === "image/jpeg") {
      mimeType = "image/jpeg";
    }

    // Crear el cuerpo de la solicitud para la API de Mistral
    const mistralReq = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        // ¡Aquí la corrección: 'image_url' en lugar de 'document_url'!
        image_url: `data:${mimeType};base64,${base64Str}`
      }
    };

    // Realizar la solicitud a la API de Mistral
    const ocrResp = await axios.post("https://api.mistral.ai/v1/ocr", mistralReq, {
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const ocrData = ocrResp.data;

    // Procesar la respuesta de la API
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;

    if (ocrData.pages && Array.isArray(ocrData.pages)) {
      ocrData.pages.forEach(page => {
        // 'pages[].text_md' o 'pages[].markdown' según la versión
        if (page.text_md) {
          textoCompleto += page.text_md + "\n";
        }
        if (page.words_confidence && Array.isArray(page.words_confidence)) {
          page.words_confidence.forEach(w => {
            totalWords++;
            sumConfidence += (w.confidence || 0);
          });
        }
      });
    }

    let avgConfidence = (totalWords > 0) ? (sumConfidence / totalWords) : 1;

    // Aquí simulamos un parseo heurístico simplificado (puedes mejorarlo a tu gusto)
    let lineas = textoCompleto.split("\n").map(l => l.trim()).filter(Boolean);
    let jugadas = [];
    let camposDudosos = [];

    // Si la confianza es menor a 0.75, marcamos todo como dudoso
    if (avgConfidence < 0.75) {
      camposDudosos = ["fecha", "track", "tipoJuego", "modalidad", "numeros", "montoApostado"];
    }

    // Ejemplo tonto: por cada línea, la tratamos como "jugada"
    lineas.forEach(line => {
      jugadas.push({
        fecha: "2025-01-01",
        track: "NY Evening",
        tipoJuego: "desconocido",
        modalidad: "desconocido",
        numeros: line,
        montoApostado: 1.00,
        notas: "",
        confianza: avgConfidence
      });
    });

    // Ejemplo: guardamos en la base 'ticketsOCR' (opcional)
    /*
    await db.collection("ticketsOCR").insertOne({
      createdAt: new Date(),
      raw: textoCompleto,
      jugadas,
      confidence: avgConfidence
    });
    */

    return res.json({
      success: true,
      resultado: {
        textoCompleto,
        jugadas,
        camposDudosos
      }
    });

  } catch (err) {
    console.error("Error en /ocr:", err.message);
    return res.json({ success: false, error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
