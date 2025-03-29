 "use strict";

// Cargar variables de entorno desde .env
require('dotenv').config();

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
const { MongoClient } = require("mongodb");
const dayjs = require("dayjs");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Ajusta según tu entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/dbName";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Assistant y Organization
const ASSISTANT_ID = "asst_iPQIGQRDCf1YeQ4P3p9ued6W";
const OPENAI_ORG_ID = "org-16WwdoiZ4EncYTJ278q6TQoF"; // si hace falta

// Funciones auxiliares
const ApiClient = {
  // Wrapper para axios con reintentos y manejo de errores
  async request(config, retries = 3, initialDelay = 1000) {
    let lastError;
    let delay = initialDelay;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await axios(config);
      } catch (error) {
        lastError = error;
        // Solo reintentar en errores 5xx (del servidor) o errores de red
        const shouldRetry = !error.response || error.response.status >= 500;
        
        if (!shouldRetry || attempt === retries - 1) {
          break; // No reintentar o último intento
        }

        console.log(`API Reintento ${attempt + 1}/${retries} tras error: ${error.message}. Esperando ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // Backoff exponencial
      }
    }
    throw lastError;
  },

  // Headers de OpenAI
  getOpenAIHeaders(extraHeaders = {}) {
    return {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "assistants=v2",
      "OpenAI-Organization": OPENAI_ORG_ID,
      ...extraHeaders
    };
  }
};

// Funciones de OCR
const OcrService = {
  /**
   * Redimensiona una imagen para optimizarla para OCR
   */
  async resizeImage(buffer) {
    return sharp(buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();
  },

  /**
   * Sube un archivo a OpenAI
   */
  async uploadFileToOpenAI(buffer, filename, mimetype) {
    const formData = new FormData();
    formData.append("purpose", "assistants");
    formData.append("file", buffer, {
      filename: filename || "ticket.jpeg",
      contentType: mimetype
    });

    const response = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/files",
      data: formData,
      headers: {
        ...ApiClient.getOpenAIHeaders(),
        ...formData.getHeaders()
      }
    });
    
    return response.data.id; // file_id
  },

  /**
   * Crea un mensaje con el prompt detallado de OCR para tickets
   */
  getDetailedPrompt(serverTime) {
    // Formato de hora para el prompt
    const formattedTime = serverTime.format("YYYY-MM-DD HH:mm:ss Z");
    
    return `Por favor, analiza la imagen adjunta de un ticket de lotería manuscrito y extrae la información siguiendo estas reglas estrictas. La hora actual del servidor es ${formattedTime}. Devuelve el resultado ÚNICAMENTE como un objeto JSON válido con la estructura definida a continuación. No incluyas ningún texto explicativo fuera del objeto JSON.

Estructura JSON Requerida:
{
  "ticketInfo": {
    "fecha": "MM/DD/YY", "track": "Track Name(s)", "esFechaDudosa": boolean, "esTrackDudoso": boolean
  },
  "jugadas": [
    {
      "numeroJugada": number, "numero": "string", "straight": number, "box": number, "combo": number,
      "tipoJuegoInferido": "string", "modalidadInferida": "string",
      "esNumeroDudoso": boolean, "esMontoDudoso": boolean, "esTipoJuegoDudoso": boolean, "esModalidadDudosa": boolean
    }
    // ... más jugadas
  ]
}

Reglas Detalladas de Interpretación y Extracción:

1.  **Objetivo Principal:** Extraer fecha, track, números apostados y montos por modalidad (Straight, Box, Combo) de cada jugada en el ticket. Identificar internamente el tipo de juego y modalidad para aplicar las reglas correctamente. NO calcular premios ni verificar ganadores.

2.  **Tipos de Juego a Reconocer (para aplicar reglas internas):**
    *   **Peak 3:** 3 dígitos (000-999).
    *   **Win 4:** 4 dígitos (0000-9999).
    *   **Venezuela:** Quiniela (2 dígitos, 3 posiciones), Pale (4 dígitos = 2 parejas, Full/Parcial).
    *   **Santo Domingo (RD):** Quiniela/Patas (2 dígitos, 3 posiciones), Pale (4 dígitos = 2 parejas, Full/Parcial).
    *   **Pulito:** 2 dígitos asociados a posiciones de Peak 3 o Win 4.
    *   **Single Action:** 1 dígito (0-9), a veces asociado a posiciones o carreras (NY Horses).

3.  **Modalidades y Montos:**
    *   **Peak 3:** Straight, Box (3-Way, 6-Way), Combo, Round Down (ej: "12X").
    *   **Win 4:** Straight, Box (4-Way, Double, Triple, Quad), Round Down (ej: "123X").
    *   **Venezuela/RD Quiniela/Patas:** Apuesta a 2 dígitos en posiciones (1ra, 2da, 3ra). El monto aplica a la pareja en la posición indicada o en todas si no se especifica.
    *   **Venezuela/RD Pale:** Apuesta a 2 parejas (4 dígitos). Interpretar si es Full o Parcial según reglas (no necesario en JSON final, pero sí para entender montos).
    *   **Pulito:** Apuesta a 2 dígitos en posición específica (ej: "(1)" o "(2)" sobre el número Peak3/Win4). Puede ser Straight (defecto) o Box.
    *   **Single Action:** Apuesta a 1 dígito.
    *   **Interpretación de Montos:**
        *   Reconocer $, decimales. Mínimo $0.01. Máximos varían (ej: $100 RD Quiniela, $10 Win4 Straight NY). Usa el contexto del juego inferido.
        *   Notación "X/Y" (ej: "50/50") = X para Straight, Y para Box. Asignar a \`straight\` y \`box\` respectivamente.
        *   "Combo" se indica con monto + palabra "Combo". Asignar a \`combo\`.
        *   Montos sin decimales (ej: "50"): Asumir centavos (0.50) si es bajo y típico. Si hay ambigüedad (ej: "1" puede ser $1.00 o $0.01), usa el contexto. Si persiste, asigna el valor más probable y marca \`esMontoDudoso: true\`.
        *   Si no hay monto explícito para una modalidad (Straight/Box/Combo), asigna 0.

4.  **Manejo de Datos Faltantes y Defaults:**
    *   **Fecha:** Busca formato MM/DD/YY. Si falta o es ilegible, usa la fecha actual del servidor (provista al inicio de este prompt) formateada como MM/DD/YY y marca \`esFechaDudosa: true\`.
    *   **Track/Lotería:** Busca nombres (NY Midday, Evening, Georgia, SantoDomingo, Venezuela, etc.). Si falta o es ilegible:
        *   Si el contexto sugiere USA, usa la hora del servidor: antes de 2:15 PM -> "NY Midday (Default)", después -> "NY Evening (Default)".
        *   Si el contexto sugiere RD o Vzla, usa "Desconocido (Default)".
        *   En cualquier caso de default o ilegibilidad, marca \`esTrackDudoso: true\`.
    *   **Tipo de Juego / Modalidad:** Infiere basado en dígitos y notas. Si no se puede determinar con confianza, asigna el más probable en \`tipoJuegoInferido\`/\`modalidadInferida\` y marca \`esTipoJuegoDudoso: true\` o \`esModalidadDudosa: true\`.

5.  **Interpretación de Escritura Manual:**
    *   "X" en Peak 3/Win 4 indica Round Down (ej: "12X", "123X"). Incluye la 'X' en el campo \`numero\`.
    *   Flechas o líneas aplican un monto a jugadas subsiguientes.
    *   Quiniela/Patas: "45-1ra", "45 P1" indican posición. Incluir en \`numero\` si es posible (ej: "45 P1") o inferir la modalidad.
    *   Pulito: "(1)" o "(2)" sobre/cerca del número indican posición. Incluir en \`numero\` si es posible (ej: "123(1)").
    *   Pale: Dos parejas separadas por "-", "x", "+". Incluir en \`numero\` (ej: "45-67").

6.  **Secuencia y Orden:** Asigna \`numeroJugada\` secuencialmente (1, 2, 3...) leyendo de arriba abajo, izquierda a derecha.

7.  **Manejo de Incertidumbre (IMPORTANTE):**
    *   Si tienes BAJA CONFIANZA al leer un número/dígito, asigna el valor más probable pero marca \`esNumeroDudoso: true\`.
    *   Si tienes BAJA CONFIANZA al interpretar un monto o su aplicación (ambigüedad, ilegible), asigna el valor más probable pero marca \`esMontoDudoso: true\`.
    *   Si tienes BAJA CONFIANZA al clasificar el tipo de juego (Peak 3 vs Win 4 vs Otro), marca \`esTipoJuegoDudoso: true\`.
    *   Si tienes BAJA CONFIANZA al clasificar la modalidad (Straight vs Box vs Combo vs Pale), marca \`esModalidadDudosa: true\`.
    *   Si un número es completamente ilegible, usa "ILEGIBLE" en el campo \`numero\` y marca \`esNumeroDudoso: true\`.

8.  **Formato de Salida Final:** La respuesta DEBE SER *exclusivamente* el objeto JSON válido descrito al inicio. Sin explicaciones adicionales.

Analiza cuidadosamente la imagen y aplica estas reglas detalladas para generar el JSON.`;
  },

  /**
   * Crea un thread y un run en OpenAI con la imagen y el prompt
   */
  async createAndRunAssistant(fileId, prompt) {
    const response = await ApiClient.request({
      method: "post",
      url: "https://api.openai.com/v1/threads/runs",
      data: {
        assistant_id: ASSISTANT_ID,
        thread: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: prompt
                },
                {
                  type: "image_file",
                  image_file: {
                    file_id: fileId
                  }
                }
              ]
            }
          ]
        },
        response_format: { type: "json_object" }
      },
      headers: {
        ...ApiClient.getOpenAIHeaders(),
        "Content-Type": "application/json"
      }
    });
    
    return {
      runId: response.data.id,
      threadId: response.data.thread_id,
      status: response.data.status
    };
  },

  /**
   * Espera a que un run termine, con polling periódico
   */
  async pollRunStatus(threadId, runId, initialStatus) {
    const finalStates = new Set(["completed", "failed", "incomplete", "cancelled", "cancelling", "expired"]);
    let status = initialStatus;
    
    while (!finalStates.has(status)) {
      console.log(`Run status = ${status}. Esperando 1s...`);
      await new Promise(r => setTimeout(r, 1000));
      
      const response = await ApiClient.request({
        method: "get",
        url: `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        headers: ApiClient.getOpenAIHeaders()
      });
      
      status = response.data.status;
    }
    
    return status;
  },

  /**
   * Obtiene la respuesta del asistente
   */
  async getAssistantResponse(threadId) {
    const response = await ApiClient.request({
      method: "get",
      url: `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      headers: ApiClient.getOpenAIHeaders()
    });
    
    const allMessages = response.data.data;
    const assistantMsg = allMessages.find(m => m.role === "assistant");
    
    if (!assistantMsg) {
      throw new Error("No se encontró mensaje del assistant");
    }
    
    return assistantMsg.content || "";
  },

  /**
   * Parsea el contenido del asistente a JSON
   */
  parseAssistantResponse(rawContent) {
    function tryParseJSON(str) {
      try { 
        return JSON.parse(str); 
      } catch (e) { 
        console.error("Error parseando JSON:", e.message);
        return null; 
      }
    }
    
    // Diferentes formatos que puede devolver la API
    if (Array.isArray(rawContent)) {
      // Ej: [ { type: "text", text: { value: "..." } }, ... ]
      const textPart = rawContent.find(p => p.type === "text");
      if (textPart?.text?.value) {
        return tryParseJSON(textPart.text.value);
      }
    } else if (typeof rawContent === "string") {
      // Directamente un string JSON
      return tryParseJSON(rawContent);
    } else if (typeof rawContent === "object" && rawContent.type === "text") {
      // Un solo objeto { type: "text", text: { value: "..." } }
      if (rawContent.text?.value) {
        return tryParseJSON(rawContent.text.value);
      }
    }
    
    return null;
  },

  /**
   * Transforma la respuesta en formato uniforme utilizable por el cliente
   */
  transformResponseForClient(parsedResponse) {
    // Si no hay respuesta válida
    if (!parsedResponse || !parsedResponse.jugadas || !Array.isArray(parsedResponse.jugadas)) {
      return { jugadas: [] };
    }
    
    // Transformar cada jugada al formato esperado por el cliente
    const jugadas = parsedResponse.jugadas.map(j => {
      // Formato base que siempre devolvemos
      const jugadaTransformada = {
        numeros: j.numero || "",
        montoApostado: (j.straight || 0) + (j.box || 0) + (j.combo || 0),
        // Añadimos los campos específicos de modalidad
        straight: j.straight || 0,
        box: j.box || 0,
        combo: j.combo || 0
      };
      
      // Flags de incertidumbre (para destacar en el frontend)
      if (j.esNumeroDudoso || j.esMontoDudoso || j.esTipoJuegoDudoso || j.esModalidadDudosa) {
        jugadaTransformada.esDudoso = true;
        
        // Detalles de las dudas (para debug o UI avanzada)
        jugadaTransformada.detallesDudas = {
          numero: j.esNumeroDudoso || false,
          monto: j.esMontoDudoso || false,
          tipoJuego: j.esTipoJuegoDudoso || false,
          modalidad: j.esModalidadDudosa || false
        };
      }
      
      return jugadaTransformada;
    });
    
    // Información del ticket (opcional, puede ser útil para el frontend)
    const ticketInfo = parsedResponse.ticketInfo ? {
      fecha: parsedResponse.ticketInfo.fecha || "",
      track: parsedResponse.ticketInfo.track || "",
      esDudoso: parsedResponse.ticketInfo.esFechaDudosa || parsedResponse.ticketInfo.esTrackDudoso || false
    } : null;
    
    return { 
      jugadas,
      ticketInfo
    };
  }
};

// Mongo
let db = null;
(async () => {
  try {
    const client = await new MongoClient(MONGODB_URI, { useUnifiedTopology: true }).connect();
    db = client.db();
    console.log("Conectado a MongoDB => 'ticketsOCR'.");
  } catch (e) {
    console.error("Error conectando a MongoDB:", e);
  }
})();

// Servir carpeta public
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * RUTA /ocr
 * Versión refactorizada con mejor manejo de errores, reintentos y nuevo prompt
 */
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }
  if (!OPENAI_API_KEY) {
    return res.json({ success: false, error: "Falta la OPENAI_API_KEY" });
  }

  try {
    console.log("---- /ocr ----");
    console.log("Imagen recibida:", req.file.originalname, "size:", req.file.size);

    // Obtenemos la hora actual para el prompt y defaults
    const serverTime = dayjs();
    
    // 1) Redimensionar imagen
    const resizedBuf = await OcrService.resizeImage(req.file.buffer);
    
    // 2) Subir a OpenAI Files
    const fileId = await OcrService.uploadFileToOpenAI(
      resizedBuf, 
      req.file.originalname || "ticket.jpeg", 
      req.file.mimetype
    );
    console.log("Archivo subido a OpenAI, fileId =>", fileId);
    
    // 3) Crear prompt detallado con reglas de interpretación
    const detailedPrompt = OcrService.getDetailedPrompt(serverTime);
    
    // 4) Crear thread y run con el prompt y la imagen
    const { threadId, runId, status: initialStatus } = await OcrService.createAndRunAssistant(fileId, detailedPrompt);
    console.log("Creado run =>", { threadId, runId, initialStatus });
    
    // 5) Esperar a que finalice el run
    const finalStatus = await OcrService.pollRunStatus(threadId, runId, initialStatus);
    if (finalStatus !== "completed") {
      return res.json({
        success: false,
        error: `El run finalizó con estado: ${finalStatus}`
      });
    }
    
    // 6) Obtener respuesta del asistente
    const rawContent = await OcrService.getAssistantResponse(threadId);
    console.log("Contenido raw del assistant recibido");
    
    // 7) Parsear respuesta a JSON
    const parsedResponse = OcrService.parseAssistantResponse(rawContent);
    if (!parsedResponse) {
      return res.json({
        success: false,
        error: "No se pudo parsear la respuesta del asistente"
      });
    }
    
    // 8) Transformar respuesta para el cliente, en formato compatible con frontend existente
    const resultado = OcrService.transformResponseForClient(parsedResponse);
    
    // 9) Guardar en MongoDB
    if (db) {
      await db.collection("ticketsOCR").insertOne({
        createdAt: new Date(),
        serverTime: serverTime.toISOString(),
        rawAssistantOutput: rawContent,
        parsedResponse,
        resultado
      });
    }
    
    // 10) Devolver respuesta
    return res.json({
      success: true,
      resultado,
      debug: {
        runId,
        threadId,
        runStatus: finalStatus,
        rawOcr: rawContent
      }
    });

  } catch (err) {
    console.error("Error en /ocr =>", err.message);
    if (err.response && err.response.data) {
      console.error("err.response.data =>", JSON.stringify(err.response.data, null, 2));
    }
    return res.json({
      success: false,
      error: err.response?.data?.error?.message || err.message
    });
  }
});

// Iniciar server
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
