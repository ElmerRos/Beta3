 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const sharp = require("sharp");
const { MongoClient } = require("mongodb");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Ajusta según tu entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/dbName";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
// Assistant ID y (opcional) Organization ID
const ASSISTANT_ID = "asst_iPQIGQRDCf1YeQ4P3p9ued6W";
const OPENAI_ORG_ID = "org-16WwdoiZ4EncYTJ278q6TQoF"; // si tu org es esta

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

// Servir carpeta public (index.html, scripts.js, etc.)
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * RUTA /ocr
 * Sube la imagen, la redimensiona, y llama a:
 *   1) POST /v1/threads/runs => crea un "thread + run" con assistant_id
 *   2) Esperamos en bucle a que el run pase a "completed" (o un estado final)
 *   3) GET /v1/threads/{thread_id}/messages => vemos el mensaje final del assistant
 */
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen" });
  }
  if (!OPENAI_API_KEY) {
    return res.json({ success: false, error: "Falta la OPENAI_API_KEY" });
  }

  try {
    console.log("---- /ocr ----");
    console.log("Imagen recibida:", req.file.originalname, "size:", req.file.size);

    // 1) Redimensionar
    const resized = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // 2) base64
    const base64Str = `data:${req.file.mimetype};base64,${resized.toString("base64")}`;

    // 3) Crear "thread + run" en un solo paso
    //    POST /v1/threads/runs
    // Body => { assistant_id, thread: { messages: [...] }, etc. }
    const runResp = await axios.post(
      "https://api.openai.com/v1/threads/runs",
      {
        assistant_id: ASSISTANT_ID,
        thread: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: {
                    value: "Por favor, analiza este ticket manuscrito y devuélveme un JSON",
                    annotations: []
                  }
                },
                {
                  type: "image",
                  image: {
                    value: base64Str,
                    annotations: []
                  }
                }
              ]
            }
          ]
        },
        // Forzamos JSON object
        response_format: { type: "json_object" },
        // Si tienes access, pon tools: []
        // "tools": [],
        temperature: 1.0,
        top_p: 1.0
        // etc.
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
          "OpenAI-Organization": OPENAI_ORG_ID // si hace falta
        }
      }
    );

    const runData = runResp.data; // => { id, object: 'thread.run', thread_id, status, ... }
    console.log("Creado run =>", JSON.stringify(runData, null, 2));

    const runId = runData.id;
    const threadId = runData.thread_id;
    let status = runData.status;
    // 4) Esperamos a que "status" sea "completed" (u otro final)
    const finalStates = new Set(["completed","failed","incomplete","cancelled","cancelling","expired"]);
    
    while (!finalStates.has(status)) {
      console.log(`Run status = ${status}. Esperando 1s...`);
      await new Promise(r => setTimeout(r, 1000));
      // Checar run
      const check = await axios.get(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
            "OpenAI-Organization": OPENAI_ORG_ID
          }
        }
      );
      status = check.data.status;
    }

    // Revisamos si status final es "completed" => entonces consultamos los mensajes
    if (status !== "completed") {
      // => run fallido, incomplete, etc.
      return res.json({
        success: false,
        error: `Run finalizó en estado: ${status}.`
      });
    }

    // 5) GET /v1/threads/{thread_id}/messages => para leer la respuesta final del assistant
    const msgsResp = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
          "OpenAI-Organization": OPENAI_ORG_ID
        }
      }
    );

    const allMessages = msgsResp.data.data; // array
    console.log("Mensajes (desc):", JSON.stringify(allMessages, null, 2));

    // Buscamos el primer message con role="assistant"
    const assistantMsg = allMessages.find(m => m.role === "assistant");
    if (!assistantMsg) {
      return res.json({ success: false, error: "No se encontró la respuesta del assistant en los mensajes." });
    }

    // assistantMsg.content => string u array
    let rawContent = assistantMsg.content || "";
    let jugadas = [];
    let camposDudosos = [];

    // Intentar parsear
    if (typeof rawContent === "string") {
      try {
        const parsed = JSON.parse(rawContent);
        if (Array.isArray(parsed)) {
          jugadas = parsed;
        } else if (Array.isArray(parsed.jugadas)) {
          jugadas = parsed.jugadas;
          camposDudosos = parsed.camposDudosos || [];
        } else {
          jugadas = [parsed];
        }
      } catch(e) {
        console.warn("No se pudo parsear JSON. rawContent=", rawContent);
      }
    } else if (typeof rawContent === "object") {
      if (Array.isArray(rawContent.jugadas)) {
        jugadas = rawContent.jugadas;
        camposDudosos = rawContent.camposDudosos || [];
      } else {
        jugadas = [rawContent];
      }
    }

    // 6) Guardar log en Mongo
    if (db) {
      await db.collection("ticketsOCR").insertOne({
        createdAt: new Date(),
        rawAssistantOutput: rawContent,
        jugadas,
        camposDudosos
      });
    }

    // 7) Responder al front
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos
      },
      debug: {
        runId,
        threadId,
        runStatus: status,
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
  console.log("Servidor en puerto", PORT);
});
