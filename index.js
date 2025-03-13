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
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // Convertir la imagen a base64
    const base64Str = resizedBuffer.toString("base64");

    // Determinar el tipo MIME de la imagen
    let mimeType = "image/png";
    if (req.file.mimetype === "image/jpeg") {
      mimeType = "image/jpeg";
    }

    // IMPORTANTE: aquí usamos "image_url" en lugar de "document_url"
    const mistralReq = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      }
    };

    // Llamar a la API de Mistral
    const ocrResp = await axios.post("https://api.mistral.ai/v1/ocr", mistralReq, {
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const ocrData = ocrResp.data;

    // Extraer texto y calcular confianza promedio
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;

    if (ocrData.pages && Array.isArray(ocrData.pages)) {
      ocrData.pages.forEach(page => {
        // Algunas versiones devuelven page.markdown o page.text_md
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

    // Parseo heurístico del texto extraído
    let lineas = textoCompleto
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    let jugadas = [];
    let camposDudosos = [];

    // Si la confianza promedio es baja, consideramos todos los campos como dudosos
    if (avgConfidence < 0.75) {
      camposDudosos = ["fecha", "track", "tipoJuego", "modalidad", "numeros", "montoApostado"];
    }

    // Bucle para analizar cada línea y extraer info
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

      // Detección de tipo de juego
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

      // Detección de modalidad
      if (lower.includes("combo")) {
        jug.modalidad = "Combo";
      } else if (lower.includes("box")) {
        jug.modalidad = "Box";
      } else if (lower.includes("straight")) {
        jug.modalidad = "Straight";
      } else if (lower.includes("round") || lower.includes("x")) {
        jug.modalidad = "RoundDown";
      } else {
        jug.modalidad = "desconocido";
      }

      // (Ejemplo) Detección de monto y/o números (podrías mejorarlo con regex)
      // if (lower.match(/\d{2,4}/)) { jug.numeros = ... }
      // if (lower.match(/\$\d+(\.\d{1,2})?/)) { jug.montoApostado = ... }

      // Añadir esta jugada al array (si deseas filtrar algo, hazlo antes)
      jugadas.push(j);
    });

    // (Opcional) Guardar en MongoDB la respuesta, si quieres
    // await db.collection("ticketsOCR").insertOne({
    //   fechaProcesado: new Date(),
    //   textoCompleto,
    //   jugadas,
    //   camposDudosos,
    //   avgConfidence
    // });

    // Devolver respuesta al frontend
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos,
        avgConfidence,
        textoCompleto
      }
    });

  } catch (err) {
    console.error("Error procesando OCR:", err);
    return res.json({ success: false, error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
