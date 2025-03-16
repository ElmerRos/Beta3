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
const OPENAI_ORG_ID = "org-16WwdoiZ4EncYTJ278q6TQoF"; // si hace falta

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

    // 1) Redimensionar
    const resized = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // 2) base64 (sin la parte "data:...;base64," para no duplicar)
    const base64Raw = resized.toString("base64");

    // Determina mimeType => si no tienes otra forma, toma el de req.file.mimetype
    const mimeType = req.file.mimetype || "image/jpeg";
    // Nombre de archivo arbitrario
    const filename = req.file.originalname || "ticket.jpeg";

    // 3) Crear "thread + run" => POST /v1/threads/runs
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
                  text: "Por favor, analiza este ticket manuscrito y devuélveme un JSON."
                },
                {
                  // *** IMPORTANTE: type = "image_file"
                  type: "image_file",
                  image_file: {
                    // Debe ser un objeto => file + filename
                    file: {
                      content: base64Raw,  // base64 sin "data:...;base64,"
                      mime_type: mimeType
                    },
                    filename: filename
                  }
                }
              ]
            }
          ]
        },
        response_format: { type: "json_object" },
        temperature: 1.0,
        top_p: 1.0
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

    const runData = runResp.data; // => { id, thread_id, status, ... }
    console.log("Creado run =>", JSON.stringify(runData, null, 2));

    const runId = runData.id;
    const threadId = runData.thread_id;
    let status = runData.status;
    const finalStates = new Set(["completed","failed","incomplete","cancelled","cancelling","expired"]);

    // Bucle => esperar a que el run pase a "completed" o estado final
    while (!finalStates.has(status)) {
      console.log(`Run status = ${status}. Esperando 1s...`);
      await new Promise(r => setTimeout(r, 1000));
      // GET /v1/threads/{thread_id}/runs/{run_id}
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

    if (status !== "completed") {
      return res.json({
        success: false,
        error: `El run finalizó con estado: ${status}`
      });
    }

    // 5) GET /v1/threads/{thread_id}/messages => para leer la respuesta
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
    const allMessages = msgsResp.data.data;
    console.log("Mensajes (desc):", JSON.stringify(allMessages, null, 2));

    // Buscamos role="assistant"
    const assistantMsg = allMessages.find(m => m.role==="assistant");
    if (!assistantMsg) {
      return res.json({ success:false, error:"No se encontró mensaje del assistant" });
    }

    let rawContent = assistantMsg.content || "";
    let jugadas = [];
    let camposDudosos = [];

    // parse JSON
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
        console.warn("No parse JSON. rawContent=", rawContent);
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

    // 7) Responder
    return res.json({
      success: true,
      resultado: { jugadas, camposDudosos },
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
  console.log("Servidor corriendo en puerto", PORT);
});
