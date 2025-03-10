 /*******************************************************
 * index.js - MÓDULO OCR ROBUSTO con Mistral 
 * Basado en:
 *  - Estructura de tickets descrita en el "Prompt Único"
 *  - Manejo de 6 juegos: Peak3, Win4, Venezuela, StoDomingo,
 *    Pulito, SingleAction.
 *  - Valores por defecto y validaciones.
 *******************************************************/

"use strict";

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const app = express();

// Almacenamiento en memoria para subir imágenes
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/db";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

// Conexión global a Mongo
let dbClient;
let db;
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db();
    console.log("Conectado a MongoDB Atlas (colección 'ticketsOCR' se crea auto).");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

/************************************************
 * 1) ENDPOINT PRINCIPAL: SIRVE HTML + REACT
 ************************************************/
app.get("/", (req, res) => {
  // Página con React embebido: drag & drop, cámara, parse de jugadas
  // Usa un array "jugadas" para mostrar la info interpretada.
  const html = `
  <!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Módulo OCR - Versión Robusta</title>
      <!-- React, ReactDOM, Babel (CDN) -->
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      <script src="https://unpkg.com/babel-standalone@6/babel.min.js"></script>
      <style>
        body { font-family: sans-serif; margin: 1rem; }
        #root { max-width: 600px; margin: auto; }
        .drop-zone {
          border: 2px dashed #ccc; 
          border-radius: 10px;
          padding: 1rem;
          text-align: center;
          cursor: pointer;
          color: #777;
          margin: 1rem 0;
        }
        .drop-zone.dragover {
          background-color: #e3f2fd; 
          border-color: #2196f3;
          color: #333;
        }
        .preview {
          max-width: 100%; 
          margin: 1rem 0;
        }
        .spinner { margin: 1rem 0; }
        .spinner div {
          width: 20px; height: 20px; background: #333;
          border-radius: 50%; display: inline-block;
          animation: bounce 0.6s infinite alternate;
        }
        .spinner div:nth-child(2) { animation-delay: 0.2s; }
        .spinner div:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { to { transform: translateY(-100%); } }
        .low-confidence { background-color: #fff3cd; }
        .jugada-box {
          border: 1px solid #ccc; padding: 0.5rem; margin: 0.5rem 0;
          border-radius: 6px;
        }
      </style>
    </head>
    <body>
      <h1>Módulo OCR - Tickets Lotería</h1>
      <div id="root"></div>

      <script type="text/babel">
      const { useState, useRef } = React;

      function App() {
        const [selectedFile, setSelectedFile] = useState(null);
        const [previewURL, setPreviewURL] = useState("");
        const [isLoading, setIsLoading] = useState(false);
        const [jugadas, setJugadas] = useState([]);   // array de jugadas parseadas
        const [camposDudosos, setCamposDudosos] = useState([]); // campos globales dudosos

        const dropZoneRef = useRef(null);

        // Drag & Drop
        function handleDragOver(e) {
          e.preventDefault();
          dropZoneRef.current.classList.add("dragover");
        }
        function handleDragLeave(e) {
          e.preventDefault();
          dropZoneRef.current.classList.remove("dragover");
        }
        function handleDrop(e) {
          e.preventDefault();
          dropZoneRef.current.classList.remove("dragover");
          const file = e.dataTransfer.files[0];
          if (file) {
            setSelectedFile(file);
            setPreviewURL(URL.createObjectURL(file));
          }
        }

        // Input normal
        function handleFileChange(e) {
          const file = e.target.files[0];
          if (file) {
            setSelectedFile(file);
            setPreviewURL(URL.createObjectURL(file));
          }
        }

        async function handleUpload() {
          if (!selectedFile) {
            alert("No se ha seleccionado ninguna imagen.");
            return;
          }
          setIsLoading(true);
          setJugadas([]);
          setCamposDudosos([]);

          const formData = new FormData();
          formData.append("ticket", selectedFile);

          try {
            const resp = await fetch("/ocr", {
              method: "POST",
              body: formData
            });
            const data = await resp.json();

            if (data.success) {
              // data.resultado.jugadas = array, data.resultado.camposDudosos = array
              setJugadas(data.resultado.jugadas || []);
              setCamposDudosos(data.resultado.camposDudosos || []);
              // Si hay muchos campos dudosos, avisa
              if (data.resultado.camposDudosos && data.resultado.camposDudosos.length > 0) {
                alert("Algunos campos podrían ser dudosos. Revisa con cuidado.");
              }
            } else {
              alert("Error al procesar la imagen: " + data.error);
            }
          } catch (err) {
            alert("Error de red u OCR: " + err.message);
          } finally {
            setIsLoading(false);
          }
        }

        function renderJugadas() {
          if (jugadas.length === 0) return null;
          return (
            <div>
              <h3>Jugadas Reconocidas</h3>
              {jugadas.map((jug, idx) => {
                const isFechaDudosa = camposDudosos.includes("fecha") || (jug.confidencia && jug.confidencia < 0.8);
                const isNumeroDudoso = jug.numeros === "ilegible" || (jug.confidencia && jug.confidencia < 0.8);
                const isTrackDudoso = (jug.track || "").includes("desconocido") || camposDudosos.includes("track");
                const isMontoDudoso = (jug.montoApostado || "") === "?" || camposDudosos.includes("montoApostado");

                return (
                  <div className="jugada-box" key={idx}>
                    <div>
                      <label>Fecha: </label>
                      <input 
                        defaultValue={jug.fecha}
                        className={isFechaDudosa ? "low-confidence" : ""}
                      />
                    </div>
                    <div>
                      <label>Track: </label>
                      <input 
                        defaultValue={jug.track}
                        className={isTrackDudoso ? "low-confidence" : ""}
                      />
                    </div>
                    <div>
                      <label>TipoJuego: </label>
                      <input defaultValue={jug.tipoJuego} />
                    </div>
                    <div>
                      <label>Modalidad: </label>
                      <input defaultValue={jug.modalidad} />
                    </div>
                    <div>
                      <label>Números: </label>
                      <input 
                        defaultValue={jug.numeros}
                        className={isNumeroDudoso ? "low-confidence" : ""}
                      />
                    </div>
                    <div>
                      <label>Monto: </label>
                      <input 
                        defaultValue={jug.montoApostado} 
                        className={isMontoDudoso ? "low-confidence" : ""}
                      />
                    </div>
                    {jug.notas && <p>Notas: {jug.notas}</p>}
                  </div>
                );
              })}
            </div>
          );
        }

        return (
          <div>
            <p>
              Sube una imagen con varios tickets o un solo ticket. 
              El sistema OCR Mistral tratará de identificar cada jugada.
            </p>

            <div
              className="drop-zone"
              ref={dropZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              Arrastra aquí la imagen del boleto...
            </div>
            
            <p>O selecciona archivo:</p>
            <input type="file" accept="image/*" capture="camera" onChange={handleFileChange} />

            {previewURL && <img src={previewURL} alt="preview" className="preview" />}

            <div>
              <button onClick={handleUpload}>Procesar OCR</button>
            </div>

            {isLoading && (
              <div className="spinner">
                <div></div><div></div><div></div>
                <p>Analizando la imagen con Mistral...</p>
              </div>
            )}

            {renderJugadas()}
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

/*******************************************************
 * 2) ENDPOINT /ocr
 *    - Recibe imagen
 *    - Llama Mistral
 *    - Parsea según tu "prompt único"
 *    - Guarda en "ticketsOCR"
 *    - Devuelve array jugadas
 *******************************************************/
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // 1) Convertimos a base64
    const base64Image = req.file.buffer.toString("base64");

    // 2) Armar cuerpo para Mistral
    const bodyMistral = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_base64",
        image_base64: base64Image
      }
    };

    // 3) Llamar a la API
    const mistralResp = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      bodyMistral,
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const ocrRaw = mistralResp.data;

    // 4) Unir texto, calcular confianza global
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;
    if (ocrRaw.pages && Array.isArray(ocrRaw.pages)) {
      ocrRaw.pages.forEach(p => {
        if (p.text_md) textoCompleto += p.text_md + "\n";
        if (p.words_confidence) {
          p.words_confidence.forEach(w => {
            totalWords++;
            sumConfidence += w.confidence || 0;
          });
        }
      });
    }
    let avgConfidence = (totalWords > 0) ? (sumConfidence / totalWords) : 1;

    // 5) Parse según tu PROMPT ÚNICO:
    //    "Objetivo, 2. Reglas de Extracción, etc."
    //    Dividimos el texto en líneas, y por cada línea detectamos jugada.
    //    (Este es un ejemplo heurístico avanzado, ajústalo a tu realidad.)

    // a) Dividir en líneas
    const lineas = textoCompleto.split("\n").map(l => l.trim()).filter(Boolean);

    // b) Armar un array "jugadas"
    let jugadas = [];
    let camposDudososGlobal = []; // si la confianza global es baja, lo marcamos

    if (avgConfidence < 0.75) {
      // Marcamos "todos" los campos como dudosos
      camposDudososGlobal = ["fecha","track","tipoJuego","modalidad","numeros","montoApostado"];
    }

    // c) Para cada línea, intentamos interpretarla
    lineas.forEach(line => {
      // Buscamos palabras clave, dígitos, etc.
      const jugada = {
        fecha: null,
        track: null,
        tipoJuego: null,
        modalidad: null,
        numeros: null,
        montoApostado: null,
        notas: "",
        confianza: avgConfidence // guardamos la conf global
      };

      // 1) Detectar tipoJuego por # dígitos o palabras
      //    Ejemplo: "peak3", "w4", "venezuela", "sd", "pulito", "single"
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("peak3") || lowerLine.includes("p3") || /\b\d{3}\b/.test(line)) {
        jugada.tipoJuego = "Peak 3";
      } else if (lowerLine.includes("win4") || lowerLine.includes("w4") || /\b\d{4}\b/.test(line)) {
        jugada.tipoJuego = "Win 4";
      } else if (lowerLine.includes("vene")) {
        jugada.tipoJuego = "Venezuela";
      } else if (lowerLine.includes("santo") || lowerLine.includes("doming")) {
        jugada.tipoJuego = "SantoDomingo";
      } else if (lowerLine.includes("pulito")) {
        jugada.tipoJuego = "Pulito";
      } else if (lowerLine.includes("single")) {
        jugada.tipoJuego = "SingleAction";
      } else {
        jugada.tipoJuego = "desconocido";
        jugada.notas += "[No se detectó juego claro] ";
      }

      // 2) Buscar modalidad (straight, box, combo, etc.)
      if (lowerLine.includes("combo")) {
        jugada.modalidad = "Combo";
      } else if (lowerLine.includes("box")) {
        jugada.modalidad = "Box";
      } else if (lowerLine.includes("straight")) {
        jugada.modalidad = "Straight";
      } else if (lowerLine.includes("round") || lowerLine.includes("x")) {
        jugada.modalidad = "RoundDown";
      } else {
        jugada.modalidad = "desconocido";
      }

      // 3) Detectar números con regex
      //    Podríamos buscar 2,3,4 dígitos (ej. 12, 123, 1234, 12X, etc.)
      //    Si se detecta “X” -> interpretamos rounddown
      let regexNros = /\b(\d{2,4}X|\d{2,4})\b/g; 
      let matchNros = line.match(regexNros);
      if (matchNros && matchNros.length > 0) {
        // Tomamos la primera coincidencia, o podríamos almacenar varias
        jugada.numeros = matchNros.join(",");
      } else {
        jugada.numeros = "ilegible";
      }

      // 4) Detectar montos con regex ($1, 0.50, 2.25, etc.)
      let regexMonto = /\$?\d+(\.\d{1,2})?/;
      let matchMonto = line.match(regexMonto);
      if (matchMonto) {
        let montoStr = matchMonto[0].replace("$","");
        jugada.montoApostado = parseFloat(montoStr);
      } else {
        jugada.montoApostado = "?";
      }

      // 5) Fecha: si no se ve en la línea, la dejamos nula (asignaremos hoy luego)
      let regexFecha = /(\b\d{4}-\d{2}-\d{2}\b)|(\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/;
      let matchFecha = line.match(regexFecha);
      if (matchFecha) {
        jugada.fecha = matchFecha[0]; // as is
      }

      // 6) Track: heurística (NY, Vzla, StoDgo, etc.)
      //    - Si no hay nada, luego asumiremos NYMidday/Evening
      if (lowerLine.includes("ny")) {
        jugada.track = "NY";
      } else if (lowerLine.includes("venez")) {
        jugada.track = "Venezuela";
      } else if (lowerLine.includes("sto") || lowerLine.includes("santo") || lowerLine.includes("doming")) {
        jugada.track = "SantoDomingo";
      } else {
        jugada.track = "desconocido";
      }

      jugadas.push(jugada);
    }); // fin forEach línea

    // d) Ajustar valores por defecto (fecha = hoy, track = "NY Midday/Evening", etc.)
    let hoy = new Date();
    let isoHoy = hoy.toISOString().slice(0,10);
    let hora = hoy.getHours() + hoy.getMinutes()/60;
    jugadas.forEach(jug => {
      // Fecha
      if (!jug.fecha) {
        jug.fecha = isoHoy;
      }
      // Track
      if (jug.track === "desconocido") {
        jug.track = (hora < 14.25) ? "NY Midday" : "NY Evening";
      } else if (jug.track === "NY") {
        // Midday o Evening
        jug.track = (hora < 14.25) ? "NY Midday" : "NY Evening";
      }
    });

    // 6) Guardar en Mongo: 
    //    Insertamos 1 doc con info general, el array de jugadas, etc.
    const col = db.collection("ticketsOCR");
    const toInsert = {
      createdAt: new Date(),
      fullText: textoCompleto,
      avgConfidence,
      jugadas
    };
    await col.insertOne(toInsert);

    // 7) Devolver jugadas al front
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos: camposDudososGlobal
      }
    });

  } catch (err) {
    console.error("Error en /ocr", err.message);
    return res.json({ success: false, error: err.message });
  }
});

/*******************************************************
 * 3) ARRANCAR SERVIDOR
 *******************************************************/
app.listen(PORT, () => {
  console.log("Servidor Módulo OCR en puerto", PORT);
});
