 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { MongoClient } = require("mongodb");

// Importamos la librería oficial de OpenAI
const { Configuration, OpenAIApi } = require("openai");

// Configuración básica
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/dbName";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Inicializamos express
const app = express();

// Multer para procesar la imagen en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Conexión a MongoDB
let db = null;
(async () => {
  try {
    const client = await new MongoClient(MONGODB_URI, { useUnifiedTopology: true }).connect();
    db = client.db();
    console.log("Conectado a MongoDB => Colección 'ticketsOCR'.");
  } catch (e) {
    console.error("Error conectando a MongoDB:", e);
  }
})();

// Configurar OpenAI
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY
  // Si tu organización es necesaria, puedes poner: organization: "org-16WwdoiZ4EncYTJ278q6TQoF"
});
const openai = new OpenAIApi(configuration);

// Servir carpeta 'public'
app.use(express.static("public"));

// Ruta GET raíz
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * NUEVO ENDPOINT: /chat-ocr
 * - Recibe la imagen (multipart/form-data, campo "ticket").
 * - Redimensiona con sharp.
 * - Convierte a Base64.
 * - Llama a Chat Completions con un system message y un user message que incluye la imagen en base64.
 * - Retorna la respuesta parseada.
 */
app.post("/chat-ocr", upload.single("ticket"), async (req, res) => {
  try {
    // Validaciones básicas
    if (!req.file) {
      return res.json({ success: false, error: "No se recibió ninguna imagen." });
    }
    if (!OPENAI_API_KEY) {
      return res.json({ success: false, error: "Falta la OPENAI_API_KEY" });
    }

    console.log("---- /chat-ocr ----");
    console.log("Imagen recibida:", req.file.originalname, "size:", req.file.size);

    // Redimensionar la imagen con sharp
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    // Convertir a base64
    const base64Str = resizedBuffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";
    // Generar un dataURL
    const dataUrl = `data:${mimeType};base64,${base64Str}`;

    // Construir los mensajes para Chat Completions
    const systemInstructions = `
Eres un modelo experto en leer e interpretar tickets de lotería escritos a mano. 
Devuelve la información en formato JSON. Cada jugada debe contener:
{
  "numeros": "...",
  "montoStraight": 0,
  "montoBox": 0,
  "montoCombo": 0,
  "track": "...",
  "fecha": "YYYY-MM-DD"
}
Si no detectas algo, ponlo en 0 o en blanco. No inventes data inexistente.
`;

    const userMessage = `
Hola, por favor analiza la siguiente imagen (un ticket manuscrito) y devuélveme 
un arreglo JSON con las jugadas. Aquí está la imagen en base64:
${dataUrl}
`;

    // Llamar a la API de OpenAI => Chat Completions
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo", // o "gpt-4" si tienes acceso
      temperature: 0.0,
      messages: [
        { role: "system", content: systemInstructions },
        { role: "user", content: userMessage }
      ]
    });

    // Extraer el texto devuelto por el assistant
    const content = response.data.choices[0].message.content || "";
    console.log("OpenAI response =>", content);

    // Intentar parsear como JSON
    let jugadas = [];
    let rawOcr = content;
    try {
      // Suponemos que GPT devolverá un JSON "puro"
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        jugadas = parsed;
      } else {
        // En caso de que sea un objeto con { jugadas: [...] }
        if (Array.isArray(parsed.jugadas)) {
          jugadas = parsed.jugadas;
        }
      }
    } catch (e) {
      console.warn("No se pudo parsear JSON del assistant. Respuesta textual.");
    }

    // Guardar en Mongo (opcional)
    if (db) {
      await db.collection("ticketsOCR").insertOne({
        createdAt: new Date(),
        rawAssistantOutput: content,
        jugadas
      });
    }

    return res.json({
      success: true,
      resultado: { jugadas },
      debug: {
        rawOcr
      }
    });

  } catch (err) {
    console.error("Error en /chat-ocr =>", err.message);
    if (err.response && err.response.data) {
      console.error("err.response.data =>", JSON.stringify(err.response.data, null, 2));
    }
    return res.json({
      success: false,
      error: err.response?.data?.error?.message || err.message
    });
  }
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
