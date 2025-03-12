 /***********************************************************
 * index.js - App Robusta con:
 *  1) Servir "index.html" estático con tu formulario + modal OCR
 *  2) POST /ocr para procesar la imagen con Mistral (formato "document_base64")
 *  3) Guardar en MongoDB Atlas (colección ticketsOCR)
 *  4) Devolver JSON con jugadas parseadas
 ***********************************************************/
"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");

// IMPORTA 'sharp' (si quieres redimensionar la imagen)
const sharp = require("sharp");

const app = express();

// Para manejar archivos en memoria
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
 * Asumiendo que están en la carpeta "public"
 ************************************************************/
app.use(express.static("public"));

/************************************************************
 * GET "/" - Sirve el archivo index.html
 * (Si deseas ubicarlo en otra ruta, ajusta path.join)
 ************************************************************/
app.get("/", (req, res) => {
  // Envia el index.html como respuesta (versión final con el modal OCR)
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/************************************************************
 * POST /ocr - Recibe la imagen, llama a Mistral, parsea,
 *             guarda en 'ticketsOCR', devuelve JSON
 ************************************************************/
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    /************************************************************
     * (1) OPCIONAL: Redimensionar imagen con 'sharp' para no exceder
     *     cierto tamaño (p.ej. 2000x2000 px). Ajusta a tu gusto.
     ************************************************************/
    // Si no quieres redimensionar, elimina este bloque y usa `req.file.buffer` directo
    let resizedBuffer = await sharp(req.file.buffer)
      .resize({
        width: 2000,      // Máximo 2000px ancho
        height: 2000,     // Máximo 2000px alto
        fit: "inside"     // Mantiene proporción (no recorta)
      })
      // .toFormat("png") // Opcional: convertir siempre a PNG
      .toBuffer();

    // Convertir a base64
    const base64Image = resizedBuffer.toString("base64");

    /************************************************************
     * (2) Llamar a la API de Mistral con el formato "document_base64"
     ************************************************************/
    const mistralReq = {
      model: "mistral-ocr-latest",
      document: {
        // Opción B según la doc => "document_base64"
        type: "document_base64",
        document_base64: base64Image
      }
    };

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

    // Unir texto y calcular confianza promedio
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;

    if (ocrData.pages && Array.isArray(ocrData.pages)) {
      ocrData.pages.forEach(page => {
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

    const avgConfidence = (totalWords > 0) ? (sumConfidence / totalWords) : 1;

    // Parse heurístico: divide en líneas, intenta detectar posibles campos
    let lineas = textoCompleto.split("\n").map(l => l.trim()).filter(Boolean);
    let jugadas = [];
    let camposDudosos = [];

    // Si la confianza media es muy baja (<0.75), marcamos todos los campos como "dudosos"
    if (avgConfidence < 0.75) {
      camposDudosos = ["fecha","track","tipoJuego","modalidad","numeros","montoApostado"];
    }

    // Para cada línea, generamos una jugada de ejemplo (DEMO)
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

      // (1) Detectar juego
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

      // (2) Modalidad
      if (lower.includes("combo")) jug.modalidad = "Combo";
      else if (lower.includes("box")) jug.modalidad = "Box";
      else if (lower.includes("straight")) jug.modalidad = "Straight";
      else if (lower.includes("round") || lower.includes("x")) jug.modalidad = "RoundDown";
      else jug.modalidad = "desconocido";

      // (3) Números (2-4 dígitos)
      let rgxNums = /\b(\d{2,4}X|\d{2,4})\b/g;
      let matches = line.match(rgxNums);
      if (matches && matches.length>0) {
        jug.numeros = matches.join(",");
      } else {
        jug.numeros = "ilegible";
      }

      // (4) Monto
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

    // Fallback para fecha y track si no se detecta nada
    let now = new Date();
    let isoHoy = now.toISOString().slice(0,10); // YYYY-MM-DD
    let hora = now.getHours() + now.getMinutes()/60;

    jugadas.forEach(j => {
      if (!j.fecha) {
        // Por defecto, fecha actual
        j.fecha = isoHoy;
      }
      if (!j.track) {
        // Por defecto => "NY Midday" si <14.25, sino "NY Evening"
        j.track = (hora<14.25) ? "NY Midday":"NY Evening";
      }
    });

    // Guardar en DB
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
    // Para ver más detalles del error Mistral, imprime err.response?.data
    console.error("Error en /ocr:", err.response?.data || err.message);

    return res.json({
      success: false,
      error: err.response?.data?.error || err.message
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
