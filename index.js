 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const sharp = require("sharp");
const { MongoClient } = require("mongodb");
const dayjs = require("dayjs");

// -------------- CONFIGURACIÓN --------------
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@host/db";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = "asst_iPQIGQRDCf1YeQ4P3p9ued6W"; 
  // <-- Este es tu Assistant ID

let dbClient;
let db;

// Conecta a Mongo (opcional, por si usas ticketsOCR)
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db();
    console.log("Conectado a MongoDB Atlas. Usando colección 'ticketsOCR'.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

// Servir archivos estáticos
app.use(express.static("public"));

// Ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -------------------------------------------
// RUTA /ocr => llamar a Assistant GPT (Beta)
// -------------------------------------------
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }
  if (!OPENAI_API_KEY) {
    return res.json({ success: false, error: "No hay OPENAI_API_KEY configurado." });
  }

  try {
    console.log("---- /ocr ----");
    console.log("Recibida imagen:", req.file.originalname, ", size:", req.file.size);

    // 1) Redimensionar la imagen
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // 2) Convertir a Base64
    const base64Str = `data:${req.file.mimetype};base64,` + resizedBuffer.toString("base64");

    // 3) Crear un "Thread" efímero
    //    POST /v1/threads
    const threadResp = await axios.post(
      "https://api.openai.com/v1/threads",
      {},
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      }
    );
    const threadId = threadResp.data.id; 
    console.log("Creado thread ID:", threadId);

    // 4) Enviar la imagen al assistant
    //    POST /v1/assistants/{assistant_id}/threads/{thread_id}/messages
    const messagesEndpoint = `https://api.openai.com/v1/assistants/${ASSISTANT_ID}/threads/${threadId}/messages`;

    // El "content" es un array con "type":"text" + "type":"image"
    const userMessage = {
      content: [
        {
          "type": "text",
          "text": "Por favor, lee este ticket de lotería y devuélveme un JSON."
        },
        {
          "type": "image",
          "image": base64Str
        }
      ]
    };

    const assistantResp = await axios.post(
      messagesEndpoint,
      userMessage,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2"
        }
      }
    );

    // 5) Procesar la respuesta
    console.log("assistantResp data:", assistantResp.data);

    // Normalmente, la respuesta es un objeto con "content".
    // "content" puede ser un string con JSON, 
    //    o si tenías "response_format"=json_object en la Assistant, vendrá JSON puro.
    let rawContent = assistantResp.data.content || "";
    // Podría ya ser un objeto. O a veces string. Depende "response_format".
    // Supongamos que es string JSON:
    let jugadas = [];
    let camposDudosos = [];

    try {
      if (typeof rawContent === "string") {
        // parsea
        const obj = JSON.parse(rawContent);
        // Tu assistant sabrá si su output es un array "jugadas" 
        //   o 1 jugada, etc.
        // Ajusta la lógica:
        if (Array.isArray(obj)) {
          jugadas = obj; 
        } else if (Array.isArray(obj.jugadas)) {
          jugadas = obj.jugadas;
          camposDudosos = obj.camposDudosos || [];
        } else {
          // fallback
          jugadas = [obj];
        }
      } else if (typeof rawContent === "object") {
        // ya es un objeto
        if (Array.isArray(rawContent.jugadas)) {
          jugadas = rawContent.jugadas;
          camposDudosos = rawContent.camposDudosos || [];
        } else {
          jugadas = [rawContent];
        }
      }
    } catch(e) {
      console.warn("No se pudo parsear como JSON. Output crudo:", rawContent);
    }

    // 6) (Opcional) Guardar en Mongo. 
    //    (Ejemplo, si quieres logs.)
    //    db.collection("ticketsOCR").insertOne({ ... })
    await db.collection("ticketsOCR").insertOne({
      createdAt: new Date(),
      rawAssistantOutput: rawContent,
      jugadas,
      camposDudosos
    });

    // 7) Responder al front-end
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos
      },
      debug: {
        rawOcr: rawContent 
      }
    });

  } catch (err) {
    console.error("Error en /ocr con Assistants API:", err.message);
    return res.json({ success: false, error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
