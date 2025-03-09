/***********************************************
 * MÓDULO OCR CON MISTRAL - Node + React + Mongo
 ***********************************************/

"use strict";

// ---------- 1) IMPORTS BÁSICOS ----------
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");

// ---------- 2) CONFIGURACIÓN GLOBAL ----------
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno (ajusta según tus datos)
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "TU_CADENA_MONGO_ATLAS";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

// Conexión global a Mongo (Atlas)
let dbClient;
let db;
(async () => {
  try {
    dbClient = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db("loteriaDB"); // Nombre de tu DB
    console.log("Conectado a MongoDB Atlas");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

// ---------- 3) ENDPOINT PRINCIPAL: Sirve la página con React ----------
app.get("/", (req, res) => {
  // Aquí servimos un HTML que contiene React + JS embebido
  // Usamos CDNs de React/ReactDOM/Babel para no crear más ficheros.
  const html = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>OCR Mistral - Módulo Demo</title>
    <!-- React, ReactDOM, Babel (CDN) -->
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/babel-standalone@6/babel.min.js"></script>
    <style>
      body { font-family: Arial, sans-serif; margin: 1rem; }
      #root { max-width: 600px; margin: auto; }
      .preview { max-width: 100%; margin: 1rem 0; }
      .low-confidence { background-color: #fff3cd; } /* amarillo suave */
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
    <h1>Módulo OCR con Mistral - Demo Integrada</h1>
    <div id="root"></div>

    <script type="text/babel">

      const { useState } = React;

      function App() {
        const [selectedFile, setSelectedFile] = useState(null);
        const [previewURL, setPreviewURL] = useState("");
        const [isLoading, setIsLoading] = useState(false);
        const [ocrData, setOcrData] = useState(null);
        const [confidenceWarning, setConfidenceWarning] = useState(false);

        // Maneja selección de archivo
        function handleFileChange(e) {
          const file = e.target.files[0];
          if (file) {
            setSelectedFile(file);
            setPreviewURL(URL.createObjectURL(file));
          }
        }

        // Envía la imagen al endpoint /ocr
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
              // OBTENEMOS LA INFORMACIÓN (PARSEADA) DEL TICKET
              setOcrData(data.resultado);

              // Verificamos si hay campos con confianza baja
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

        // Ejemplo de cómo "autollenar" un formulario
        // (En tu app real, conectarías data.resultado con tu formulario principal)
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
              {confidenceWarning && <p style={{color: "orange"}}>
                ¡Revisa los campos resaltados, la confianza de OCR fue baja!
              </p>}
            </div>
          );
        }

        return (
          <div>
            <p>Sube una foto o imagen escaneada de tu ticket de lotería.</p>
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

// ---------- 4) ENDPOINT OCR: Recibe imagen, llama a Mistral, guarda en DB ----------
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No recibí ninguna imagen." });
  }

  try {
    // 4.1 Convertimos la imagen a Base64
    const base64Image = req.file.buffer.toString("base64");

    // 4.2 Llamada a la API de Mistral
    // Asumiendo que la API de Mistral se llama así (ver docs reales):
    // Endpoint ficticio: "https://api.mistral.ai/v1/ocr"
    // Formato: { image: <base64> }
    // Autorización: Bearer MISTRAL_API_KEY
    const mistralResp = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      { image: base64Image },
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // 4.3 Extraemos resultados (aquí simulamos parse; ajusta según la respuesta real de Mistral)
    const ocrRaw = mistralResp.data; // Esto podría ser { text: "...", confidence: ..., etc. }

    // Ejemplo de parse manual (lo adaptas según tu ticket):
    // Supongamos que 'ocrRaw' devuelve: { text: "Fech:2025-03-09 Nums: 12345 track:NY" ... }
    // Aquí haríamos un proceso más inteligente con regex, etc.
    let fechaDetectada = "2025-03-09";
    let numerosDetectados = "12345";
    let trackDetectado = "NY Evening";
    let camposDudosos = [];

    // Lógica de ejemplo para asignar fecha por defecto "hoy"
    const hoy = new Date();
    const isoHoy = hoy.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    // Si Mistral no detectó fecha, la ponemos a "hoy"
    if (!fechaDetectada) {
      fechaDetectada = isoHoy;
      camposDudosos.push("fecha");
    }

    // Lógica de ejemplo para track por defecto (Midday vs Evening) según la hora
    const currentHour = hoy.getHours() + (hoy.getMinutes() / 60);
    if (!trackDetectado) {
      if (currentHour < 14.25) {
        trackDetectado = "NY Midday";
      } else {
        trackDetectado = "NY Evening";
      }
      camposDudosos.push("track");
    }

    // Nota: Si Mistral no reconoce bien 'numeros', lo marcamos
    if (!numerosDetectados) {
      numerosDetectados = "???";
      camposDudosos.push("numeros");
    }

    // 4.4 Guardar en MongoDB: ejemplo muy sencillo de guardar base64 + datos
    const ticketsColl = db.collection("tickets");
    await ticketsColl.insertOne({
      createdAt: new Date(),
      base64: base64Image,
      ocrRaw: ocrRaw, // El texto completo devuelto por Mistral
      fecha: fechaDetectada,
      numeros: numerosDetectados,
      track: trackDetectado
    });

    // 4.5 Devolvemos al front la data parseada y los campos dudosos
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
    console.error("Error OCR Mistral:", error.message);
    return res.json({ success: false, error: error.message });
  }
});

// ---------- 5) LEVANTAR SERVIDOR ----------
app.listen(PORT, () => {
  console.log("Servidor OCR escuchando en puerto:", PORT);
});
