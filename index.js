 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const sharp = require("sharp");

const app = express();

// Configuración de multer (en memoria)
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@host/db";

// Nota: se renombra la variable de API Key a algo genérico (OCR_API_KEY), 
// para no amarrarla a ningún proveedor en particular.
const OCR_API_KEY = process.env.OCR_API_KEY || "TU_API_KEY_OCR";

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

// --------------------------------------------------------
// Función de parseo robusto: interpreta el texto OCR
// y extrae jugadas según las reglas del dominio (tickets).
// --------------------------------------------------------
function parseTicketTexto(textoCompleto) {
  // Dividir texto en líneas
  const lineas = textoCompleto
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  // Array final de jugadas
  let jugadas = [];
  // Campos dudosos o advertencias
  let camposDudosos = [];

  // (Opcional) Alguna heurística para detectar track, fecha, etc.
  // Ejemplo mínimo (se puede mejorar con regex).
  
  // Pseudocódigo de parseo:
  // - Buscar si la línea contiene 2, 3, 4 dígitos => interpretarlo en "tipoJuego"
  // - Buscar palabras clave: "combo", "box", "straight", "$..."
  // - Asignar defaults si faltan
  // - En un escenario real, este parse se adaptaría a tus reglas específicas.

  // Ejemplo didáctico (muy simplificado):
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
      confianza: 1.0  // Ej. podrías calcular la confianza
    };

    // 1) Detectar cantidad de dígitos consecutivos (simplificado):
    const matchDigits = line.match(/\b(\d{1,4})(x?)\b/);
    if (matchDigits) {
      let rawNums = matchDigits[1];
      let hasX = matchDigits[2]; // indica round down si existiera la X
      // Asignar tipo de juego (ej. pick3 = 3 dígitos, etc.)
      if (rawNums.length === 1) {
        jug.tipoJuego = "Single Action";
      } else if (rawNums.length === 2) {
        jug.tipoJuego = "Venezuela"; // Ejemplo: 2 dígitos
      } else if (rawNums.length === 3) {
        jug.tipoJuego = "Pick 3";
      } else if (rawNums.length === 4) {
        jug.tipoJuego = "Win 4";
      }
      jug.numeros = hasX ? rawNums + "X" : rawNums;
    }

    // 2) Detectar modalidad por palabras
    if (lower.includes("combo")) jug.modalidad = "Combo";
    else if (lower.includes("box")) jug.modalidad = "Box";
    else if (lower.includes("straight")) jug.modalidad = "Straight";
    else if (lower.includes("round") || lower.includes("x")) {
      jug.modalidad = "RoundDown";
    } else {
      jug.modalidad = jug.modalidad || "desconocido";
    }

    // 3) Buscar montos en formato $ o sin él
    const matchMonto = line.match(/\$?(\d+(\.\d+)?)/);
    if (matchMonto) {
      let val = parseFloat(matchMonto[1]);
      jug.montoApostado = isNaN(val) ? 0 : val;
    }

    // Ejemplo de track detectado
    if (lower.includes("ny") && lower.includes("mid")) {
      jug.track = "New York Mid Day";
    } else if (lower.includes("ny") && lower.includes("even")) {
      jug.track = "New York Evening";
    }
    // (Se podrían añadir más detectores: Florida, SantoDomingo, etc.)

    // Guardar la jugada
    jugadas.push(jug);
  });

  // 4) Asignar defaults si faltan (ej. fecha = hoy, track = "NY Midday" según hora)
  //   => Se puede refinar
  jugadas.forEach(j => {
    if (!j.fecha) {
      const hoy = new Date();
      const yyyy = hoy.getFullYear();
      let mm = hoy.getMonth() + 1;
      let dd = hoy.getDate();
      // Formatear
      const f = `${yyyy}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
      j.fecha = f;
    }
    if (!j.track) {
      // Simple deducción: si es antes de 14:15 => "NY Midday", si no => "NY Evening"
      let now = new Date();
      let horas = now.getHours();
      let minutos = now.getMinutes();
      if (horas < 14 || (horas === 14 && minutos < 15)) {
        j.track = "New York Mid Day";
      } else {
        j.track = "New York Evening";
      }
    }
    if (!j.tipoJuego) {
      j.tipoJuego = "desconocido";
      camposDudosos.push("tipoJuego");
    }
    if (!j.numeros) {
      j.numeros = "ilegible";
      camposDudosos.push("numeros");
    }
  });

  return { jugadas, camposDudosos };
}

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

    // Convertir la imagen a Base64
    const base64Raw = resizedBuffer.toString("base64");
    // Limpiar saltos de línea, si existieran
    const base64Str = base64Raw.replace(/\r?\n/g, "");

    // Determinar MIME
    let mimeType = "image/png";
    if (req.file.mimetype === "image/jpeg") {
      mimeType = "image/jpeg";
    }

    // Construir payload para el servicio OCR (genérico)
    const ocrPayload = {
      model: "myOCR-latest", // o "mistral-ocr-latest", etc. Este alias es genérico
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      }
    };

    // Llamar al endpoint OCR (en una variable, por ejemplo process.env.OCR_ENDPOINT)
    const OCR_ENDPOINT = process.env.OCR_ENDPOINT || "https://api.mi-ocr.com/v1/ocr";

    const ocrResp = await axios.post(OCR_ENDPOINT, ocrPayload, {
      headers: {
        Authorization: `Bearer ${OCR_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const ocrData = ocrResp.data;

    // Extraer texto y calcular confianza (ej. sumConfidence / totalWords)
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;

    if (ocrData.pages && Array.isArray(ocrData.pages)) {
      ocrData.pages.forEach(page => {
        // Dependiendo de la versión, podría ser page.text_md, page.markdown, etc.
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

    // Usar la función parseTicketTexto para interpretar los datos
    const { jugadas, camposDudosos } = parseTicketTexto(textoCompleto);

    // (Opcional) Guardar en DB
    // await db.collection("ticketsOCR").insertOne({
    //   fechaProcesado: new Date(),
    //   rawText: textoCompleto,
    //   jugadas,
    //   camposDudosos,
    //   avgConfidence
    // });

    // Respuesta al front
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos,
        avgConfidence,
        textoCompleto,
        rawOcrData: ocrData // para debug
      }
    });

  } catch (err) {
    console.error("Error procesando OCR:", err);
    return res.json({ success: false, error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
