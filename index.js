 /***********************************************
 * MÓDULO OCR CON MISTRAL - VERSIÓN MÁS RECIENTE
 * Node + Express + React en un solo archivo
 * Manejo de MISTRAL_API_KEY por variable de entorno
 ***********************************************/

"use strict";

// ---------- 1) IMPORTS BÁSICOS ----------
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");

// ---------- 2) CONFIGURACIÓN GLOBAL ----------
const app = express();

// Para manejar archivos en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno (Render/Heroku/etc. las inyectan en runtime)
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/dbname";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

// Conexión a MongoDB Atlas
let dbClient;
let db;

// Abrimos la conexión al iniciar la app
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db(); // o dbClient.db("nombreDB") si quieres forzar el nombre
    console.log("Conectado a MongoDB Atlas correctamente.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

// ---------- 3) ENDPOINT PRINCIPAL: Sirve el HTML con React embebido ----------
app.get("/", (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Módulo OCR con Mistral</title>
    <!-- React, ReactDOM, Babel (CDN) -->
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/babel-standalone@6/babel.min.js"></script>
    <style>
      body { font-family: Arial, sans-serif; margin: 1rem; }
      #root { max-width: 600px; margin: auto; }
      .preview { max-width: 100%; margin: 1rem 0; }
      .low-confidence { background-color: #fff3cd; }
      .spinner { margin: 1rem 0; }
      .spinner div {
        width: 20px; height: 20px; background: #333;
        border-radius: 50%; display: inline-block;
        animation: bounce 0.6s infinite alternate;
      }
      .spinner div:nth-child(2) { animation-delay: 0.2s; }
      .spinner div:nth-child(3) { animation-delay: 0.4s; }
      @keyframes bounce {
        to { transform: translateY(-100%); }
      }
    </style>
  </head>
  <body>
    <h1>Módulo OCR con Mistral (versión más reciente)</h1>
    <div id="root"></div>
    <script type="text/babel">
      const { useState } = React;

      function App() {
        const [selectedFile, setSelectedFile] = useState(null);
        const [previewURL, setPreviewURL] = useState("");
        const [isLoading, setIsLoading] = useState(false);
        const [ocrData, setOcrData] = useState(null);
        const [confidenceWarning, setConfidenceWarning] = useState(false);

        function handleFileChange(e) {
          const file = e.target.files[0];
          if (file) {
            setSelectedFile(file);
            setPreviewURL(URL.createObjectURL(file));
          }
        }

        async function handleUpload() {
          if (!selectedFile) {
            alert("Por favor, selecciona una imagen primero.");
            return;
          }
          setIsLoading(true);
          setOcrData(null);
          setConfidenceWarning(false);

          const formData = new FormData();
          formData.append("ticket", selectedFile);

          try {
            const resp = await fetch("/ocr", {
              method: "POST",
              body: formData
            });
            const data = await resp.json();

            if (data.success) {
              setOcrData(data.resultado);
              if (data.resultado.camposDudosos && data.resultado.camposDudosos.length > 0) {
                setConfidenceWarning(true);
              }
            } else {
              alert("Error al procesar la imagen:\n" + data.error);
            }
          } catch (err) {
            alert("Error de red u OCR:\n" + err.message);
          } finally {
            setIsLoading(false);
          }
        }

        function renderForm() {
          if (!ocrData) return null;
          return (
            <div>
              <h3>Datos parseados del Ticket</h3>
              <div>
                <label>Fecha: </label>
                <input 
                  className={ocrData.camposDudosos?.includes("fecha") ? "low-confidence" : ""}
                  defaultValue={ocrData.fecha}
                />
              </div>
              <div>
                <label>Números: </label>
                <input 
                  className={ocrData.camposDudosos?.includes("numeros") ? "low-confidence" : ""}
                  defaultValue={ocrData.numeros}
                />
              </div>
              <div>
                <label>Lotería/Track: </label>
                <input 
                  className={ocrData.camposDudosos?.includes("track") ? "low-confidence" : ""}
                  defaultValue={ocrData.track}
                />
              </div>
              {confidenceWarning && (
                <p style={{color: "orange"}}>
                  ¡Revisa los campos resaltados, la confianza de OCR fue baja!
                </p>
              )}
            </div>
          );
        }

        return (
          <div>
            <p>Sube una foto o imagen escaneada de tu ticket de lotería. Se enviará al modelo <strong>mistral-ocr-latest</strong>.</p>
            <input type="file" accept="image/*" onChange={handleFileChange} />
            {previewURL && <img className="preview" src={previewURL} alt="Vista previa" />}
            <div>
              <button onClick={handleUpload}>Procesar con Mistral OCR</button>
            </div>

            {isLoading && (
              <div className="spinner">
                <div></div><div></div><div></div>
                <p>Analizando tu imagen...</p>
              </div>
            )}
            {renderForm()}
          </div>
        );
      }

      ReactDOM.render(<App />, document.getElementById("root"));
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

// ---------- 4) ENDPOINT /ocr: Recibe la imagen, la envía a Mistral y guarda en Mongo ----------
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No recibí ninguna imagen." });
  }

  try {
    // 4.1 Convertir la imagen a Base64
    const base64Image = req.file.buffer.toString("base64");
    // 4.2 Crear el cuerpo JSON para la API de Mistral
    //    Usamos "document.type": "image_base64" e "image_base64": <contenido>
    const mistralRequestBody = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_base64",
        image_base64: base64Image
      }
      // include_image_base64: false, // si no necesitas que devuelva la imagen en la respuesta
    };

    // 4.3 Llamar a la API de Mistral con Axios
    const mistralResp = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      mistralRequestBody,
      {
        headers: {
          "Authorization": `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // 4.4 Procesar la respuesta de Mistral
    // El JSON devuelto suele tener un formato con 'pages' o 'content' en Markdown, etc.
    // Deberás adaptar a lo que devuelva la versión final. Aquí simulamos datos.
    // Ejemplo: mistralResp.data = { pages: [ { text_md: "...", ...}, ... ] }
    const ocrRaw = mistralResp.data;

    // Extrae texto (de forma MUY simple de ejemplo). Ajusta según tu caso.
    let textoCompleto = "";
    if (ocrRaw.pages && Array.isArray(ocrRaw.pages)) {
      // Concatena el texto de cada página
      ocrRaw.pages.forEach((p) => {
        if (p.text_md) textoCompleto += p.text_md + "\n";
      });
    }

    // Simulamos "parse" para encontrar fecha, números, track, etc.
    // Aquí podrías usar regex o lógica específica.
    // ------------------------------------------
    let fechaDetectada = null;
    let numerosDetectados = null;
    let trackDetectado = null;
    let camposDudosos = [];

    // REGLA simple: Si 'textoCompleto' incluye "NY" => track = "NY Evening"
    if (textoCompleto.includes("NY")) {
      trackDetectado = "NY Evening";
    }

    // REGLA por defecto: si no detectamos track, usar midday/evening según hora
    const hoy = new Date();
    const isoHoy = hoy.toISOString().slice(0, 10); // YYYY-MM-DD
    const currentHour = hoy.getHours() + (hoy.getMinutes() / 60);

    if (!fechaDetectada) {
      fechaDetectada = isoHoy;
      camposDudosos.push("fecha");
    }
    if (!trackDetectado) {
      trackDetectado = (currentHour < 14.25) ? "NY Midday" : "NY Evening";
      camposDudosos.push("track");
    }
    if (!numerosDetectados) {
      // marcamos como desconocido
      numerosDetectados = "???";
      camposDudosos.push("numeros");
    }

    // 4.5 Guardar en MongoDB
    const ticketsColl = db.collection("ticketsOCR");
    await ticketsColl.insertOne({
      createdAt: new Date(),
      rawResponse: ocrRaw,
      textoCompleto,
      fecha: fechaDetectada,
      numeros: numerosDetectados,
      track: trackDetectado
    });

    // 4.6 Responder al Front con campos parseados
    return res.json({
      success: true,
      resultado: {
        fecha: fechaDetectada,
        numeros: numerosDetectados,
        track: trackDetectado,
        camposDudosos
      }
    });

  } catch (error) {
    console.error("Error en OCR Mistral:", error.message);
    return res.json({ success: false, error: error.message });
  }
});

// ---------- 5) LEVANTAR SERVIDOR ----------
app.listen(PORT, () => {
  console.log(`Servidor de OCR corriendo en puerto ${PORT}`);
});
