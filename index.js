 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp");
const dayjs = require("dayjs"); // Para manejar fecha/hora local (requiere "npm install dayjs")

const app = express();

// 1. Configuración de multer (en memoria)
const upload = multer({ storage: multer.memoryStorage() });

// 2. Variables de entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/db";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

// 3. Conexión a MongoDB
let dbClient;
let db;
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db(); // Nombre de la DB según tu connection string
    console.log("Conectado a MongoDB Atlas. Usando colección 'ticketsOCR'.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

// 4. Servir carpeta "public"
app.use(express.static("public"));

// 5. GET principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =======================================================================
   6. POST /ocr
      - Redimensiona imagen con sharp
      - Envía al endpoint Mistral con un prompt avanzado
      - Recibe respuesta cruda
      - Aplica heurística para parsear:
         fecha, track, tipoJuego, modalidad, numeros, monto
      - Guarda todo en MongoDB
      - Devuelve JSON con jugadas, camposDudosos y debug
======================================================================= */
app.post("/ocr", upload.single("ticket"), async (req, res) => {

  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // (A) Redimensionar imagen para no exceder 2000x2000
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // (B) Convertir a Base64
    const base64Str = resizedBuffer.toString("base64");

    // Determinar MIME
    let mimeType = "image/jpeg";
    if (req.file.mimetype === "image/png") {
      mimeType = "image/png";
    }

    // (C) Construir payload para Mistral
    //     Usamos un "prompt" basado en tus especificaciones detalladas.
    const PROMPT_INSTRUCCIONES = `
PROMPT ÚNICO PARA ENTRENAR MODELO OCR (MISTRAL) SOBRE TICKETS DE LOTERÍA

Objetivo:
Instruir al modelo OCR para que, a partir de imágenes de boletos de lotería escritos a mano, extraiga los datos relevantes (fecha, track, modalidad de juego, números apostados y montos) sin verificar premios ni ganadores. Debe manejar múltiples juegos (Peak 3, Win 4, Venezuela, Lotería de Santo Domingo, Pulito y/o Single Action), tolerar escritura confusa y asignar valores por defecto cuando falte información clave.

1. Alcance y Propósito
   - Interpretar Boletos Escritos a Mano
   - Identificar juego (Peak 3, Win 4, etc.)
   - Extraer fecha, track, modalidad, números, montos
   - Sin Verificación de Premios (no calcula ganadores)

2. Reglas de Extracción
   - Peak 3: 3 dígitos. Win 4: 4 dígitos. Venezuela (2 dígitos=quiniela, 4=pale). 
   - Santo Domingo: quiniela/patas (2 dígitos), pale (4 dígitos). 
   - Pulito: 2 dígitos. Single Action: 1 dígito (0–9).
   - Montos en dólares (ej: 0.50, 1, 2.25)
   - Manejo de datos faltantes (fecha = hoy, track = Midday/Evening).
   - Marcar ilegibles o fuera de rango si hay dudas.

3. Formato de Salida (JSON por jugada):
{
  "fecha": "YYYY-MM-DD",
  "track": "NY Midday",
  "tipoJuego": "Peak 3", 
  "modalidad": "Straight",
  "numeros": "123",
  "montoApostado": 1.00,
  "notas": "Combo" 
}

4. Criterios de Calidad
   - Si confianza < 70%, "requiere verificación manual".
   - No inventar datos inexistentes, marcar "ilegible".

5. Orientaciones
   - Preprocesar y segmentar texto. 
   - Mapear a convenciones de juego por dígitos y palabras clave.
   - Devolver JSON estructurado con dudas en "notas" o "camposDudosos".

Instrucciones finales para el Modelo Mistral:
1. Lee el ticket escrito a mano desde la imagen.
2. Extrae fecha, track, tipo de juego, modalidad, números y montos.
3. Asigna valores por defecto si faltan.
4. Devuelve un JSON por jugada, sin calcular premios.
5. Si hay ambigüedad, crea un campo “camposDudosos” o “notas”.
`;

    // Mistral payload con "instructions" + "model" + "document"
    const mistralPayload = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      },
      instructions: PROMPT_INSTRUCCIONES
    };

    // (D) Llamar a Mistral
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

    // (E) Extraer data cruda
    const ocrData = ocrResp.data; // { pages: [...], ... }

    // (F) Recopilar texto y calcular confianza
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;
    let allWords = []; // Para guardar cada palabra + su confidence

    if (Array.isArray(ocrData.pages)) {
      for (const page of ocrData.pages) {
        // texto
        if (page.text_md) {
          textoCompleto += page.text_md + "\n";
        }
        // confidence
        if (Array.isArray(page.words_confidence)) {
          for (const w of page.words_confidence) {
            allWords.push(w);
            totalWords++;
            sumConfidence += (w.confidence || 0);
          }
        }
      }
    }

    const avgConfidence = (totalWords > 0) ? sumConfidence / totalWords : 1.0;
    // Convertir a % (opcional)
    const avgConfidencePct = Math.round(avgConfidence * 100);

    // (G) Parsear localmente con heurísticas
    //  1) dividir texto en líneas
    //  2) para cada línea => parseTicketLine (retorna un array de jugadas)
    let lineas = textoCompleto
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

    // Almacenamos todas las jugadas que surjan
    let jugadas = [];
    let camposDudosos = [];

    // Si la confianza global < 70%, marcamos el ticket como dudoso
    if (avgConfidencePct < 70) {
      camposDudosos.push("OCR con confianza < 70% => requiere verificación manual");
    }

    // Función: determina la jugada a partir de la línea
    function parseTicketLine(line) {
      // Buscamos dígitos y posibles keywords
      // Regex para montos en $ Ej: 0.50, 2, 10.25
      const montoRegex = /(\d+(\.\d{1,2})?)/g;

      // Recolectamos montos
      let montosEncontrados = [];
      let matchMonto;
      while ((matchMonto = montoRegex.exec(line)) !== null) {
        montosEncontrados.push(parseFloat(matchMonto[1]));
      }

      // Detectar game keywords (peak3, win4, venezuela, etc.)
      const lowerLine = line.toLowerCase();
      let tipoJuegoDetectado = "";
      if (lowerLine.includes("peak3") || lowerLine.includes("pick3") || lowerLine.includes("pick 3") || lowerLine.includes("peak 3")) {
        tipoJuegoDetectado = "Peak 3";
      } else if (lowerLine.includes("win4") || lowerLine.includes("win 4")) {
        tipoJuegoDetectado = "Win 4";
      } else if (lowerLine.includes("venez")) {
        tipoJuegoDetectado = "Venezuela";
      } else if (lowerLine.includes("santo") || lowerLine.includes("doming") || lowerLine.includes("rd") || lowerLine.includes("loteka") || lowerLine.includes("nacional")) {
        tipoJuegoDetectado = "SantoDomingo";
      } else if (lowerLine.includes("pulito")) {
        tipoJuegoDetectado = "Pulito";
      } else if (lowerLine.includes("single")) {
        tipoJuegoDetectado = "SingleAction";
      }

      // Detectar modalidad
      let modalidadDetectada = "";
      if (lowerLine.includes("straight")) modalidadDetectada = "Straight";
      if (lowerLine.includes("box")) modalidadDetectada = "Box";
      if (lowerLine.includes("combo")) modalidadDetectada = "Combo";
      if (lowerLine.includes("rounddown") || lowerLine.includes("round down") || lowerLine.includes("rd") || lowerLine.includes("x ")) {
        modalidadDetectada = "RoundDown";
      }
      // (Se puede combinar si la línea dice "straight box"? Ejemplo a tu gusto)

      // Detectar dígitos sueltos (2-4, 1, etc.)
      // Buscamos secuencias entre 1 y 4 dígitos => definiremos el juego si no se detectó
      const numeroRegex = /\b(\d{1,4}x?)\b/gi; 
      // ( incluye "123" o "12x" => RoundDown)
      let numerosEncontrados = [];
      let matchNums;
      while ((matchNums = numeroRegex.exec(line)) !== null) {
        numerosEncontrados.push(matchNums[1].toUpperCase()); // 12X => mayúscula
      }

      // Heurística para deducir tipoJuego si no lo encontramos por keywords
      // (ej: 3 dígitos => "Peak 3", 4 => "Win 4", 2 => "Pulito o Venezuela/SD"?)
      if (!tipoJuegoDetectado && numerosEncontrados.length > 0) {
        // Tomamos el primero y contamos dígitos (ignorando la X)
        const rawNum = numerosEncontrados[0].replace(/x/i, "");
        const len = rawNum.length;
        if (len === 1) tipoJuegoDetectado = "SingleAction";
        if (len === 2) tipoJuegoDetectado = "Pulito";     // Ambiguo, pudiera ser "Venezuela" o "SantoDomingo"
        if (len === 3) tipoJuegoDetectado = "Peak 3";
        if (len === 4) tipoJuegoDetectado = "Win 4";
      }

      // Determinar la fecha (por ahora no detectamos un string “mm-dd” en la línea);
      // asumimos la de hoy => "YYYY-MM-DD"
      const fechaDetectada = dayjs().format("YYYY-MM-DD");

      // Determinar track:
      //  - si la línea menciona "midday", "eve" => definimos uno
      //  - si no, usar heurística según hora local actual
      let trackDetectado = "";
      if (lowerLine.includes("midday")) {
        trackDetectado = "NY Midday";
      } else if (lowerLine.includes("evening") || lowerLine.includes("eve")) {
        trackDetectado = "NY Evening";
      } else {
        // Heurística: si es antes de 14:15 => Midday; sino => Evening
        const nowHHmm = dayjs().hour() * 100 + dayjs().minute();
        if (nowHHmm < 1415) trackDetectado = "NY Midday";
        else trackDetectado = "NY Evening";
      }

      // Si no tenemos modalidad, podemos deducir algo:
      if (!modalidadDetectada && numerosEncontrados.some(n=>n.includes("X"))) {
        modalidadDetectada = "RoundDown";
      }

      // Tomamos el primer monto si existe (o default $1.00)
      let monto = montosEncontrados.length > 0 ? montosEncontrados[0] : 1.00;
      // Límite de ejemplo: si > 200 => dudoso
      if (monto > 200) {
        camposDudosos.push(`Monto muy alto: ${monto} (linea: "${line}")`);
      }

      // Contruimos la jugada => si no hay dígitos, devolvemos null
      if (numerosEncontrados.length === 0) {
        return null; 
      }

      return {
        fecha: fechaDetectada,
        track: trackDetectado,
        tipoJuego: tipoJuegoDetectado || "desconocido",
        modalidad: modalidadDetectada || "desconocido",
        numeros: numerosEncontrados.join(","),
        montoApostado: parseFloat(monto.toFixed(2)),
        notas: ""
      };
    }

    // Parsear cada línea
    for (const line of lineas) {
      const jugada = parseTicketLine(line);
      if (jugada) {
        jugadas.push(jugada);
      }
    }

    // (H) Guardamos en Mongo
    //     Así podrás revisar luego exactamente qué se devolvió y cómo lo parseaste
    const savedDoc = await db.collection("ticketsOCR").insertOne({
      createdAt: new Date(),
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      avgConfidencePct,
      textCompleto,
      allWords,
      jugadas,
      camposDudosos,
      ocrRawResponse: ocrData
    });

    // (I) Devolvemos la respuesta al front-end
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

// 7. Iniciar server
app.listen(PORT, () => {
  console.log(`Servidor OCR corriendo en puerto ${PORT}`);
});
