 /***********************************************************
 * index.js - App Robusta con:
 *  1) Formulario principal (Generate Ticket, campos, etc.)
 *  2) Modal interno con OCR (Drag & Drop, cámara, parse)
 *  3) Autollenado del formulario desde el modal
 *  4) Parsing Avanzado (2-4 dígitos, montos, tipos de juego)
 *  5) Guarda en MongoDB Atlas (colección ticketsOCR)
 *  6) No abre nueva pestaña, todo es una sola página
 ***********************************************************/
"use strict";

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const { MongoClient } = require("mongodb");

const app = express();

// Para manejar archivos en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Variables de entorno
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@host/db";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

let dbClient;
let db;

// Conexión a MongoDB
(async () => {
  try {
    dbClient = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await dbClient.connect();
    db = dbClient.db();
    console.log("Conectado a MongoDB Atlas. Colección 'ticketsOCR' se crea al insertar.");
  } catch (err) {
    console.error("Error conectando a MongoDB:", err);
  }
})();

/************************************************************
 * GET "/" - Sirve la ÚNICA página con:
 *   - Formulario Principal
 *   - Botón "Abrir Modal" (sin salir de la página)
 *   - Modal con Módulo OCR
 *   - Al confirmar en el modal, se autocompleta el formulario
 ************************************************************/
app.get("/", (req, res) => {
  // Aquí tenemos React + un Modal Bootstrap (o uno casero).
  // El modal contiene la lógica Drag/Drop, y al parsear, rellena el form principal.

  const html = `
  <!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>App Lotería + OCR Mistral</title>
      <!-- React, ReactDOM, Babel (CDN) -->
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      <script src="https://unpkg.com/babel-standalone@6/babel.min.js"></script>

      <!-- (Opcional) Bootstrap CSS para estilizar el modal -->
      <link rel="stylesheet" 
            href="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/css/bootstrap.min.css" />

      <style>
        body { font-family: Arial, sans-serif; margin: 1rem; }
        #root { max-width: 800px; margin: auto; }
        .field-box { margin-bottom: 0.5rem; }
        .preview { max-width: 100%; margin: 1rem 0; }
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
      </style>
    </head>
    <body>
      <div id="root"></div>

      <!-- Bootstrap JS (para modal) -->
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.2.3/dist/js/bootstrap.bundle.min.js"></script>

      <script type="text/babel">
        const { useState, useRef, useEffect } = React;

        function App() {
          // Campos del Formulario Principal (ejemplo)
          const [fecha, setFecha] = useState("");
          const [track, setTrack] = useState("");
          const [tipoJuego, setTipoJuego] = useState("");
          const [modalidad, setModalidad] = useState("");
          const [numeros, setNumeros] = useState("");
          const [monto, setMonto] = useState("");

          // Modal OCR: states
          const [showModal, setShowModal] = useState(false);  // controla visibilidad
          const [selectedFile, setSelectedFile] = useState(null);
          const [previewURL, setPreviewURL] = useState("");
          const dropZoneRef = useRef(null);
          const [isLoading, setIsLoading] = useState(false);
          const [jugadas, setJugadas] = useState([]);
          const [camposDudosos, setCamposDudosos] = useState([]);

          // Función para abrir/cerrar modal
          function abrirModal() {
            setShowModal(true);
            // Reset OCR states
            setSelectedFile(null);
            setPreviewURL("");
            setIsLoading(false);
            setJugadas([]);
            setCamposDudosos([]);
          }
          function cerrarModal() {
            setShowModal(false);
          }

          // Drag & Drop Handlers
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

          // Input normal de archivo
          function handleFileChange(e) {
            const file = e.target.files[0];
            if (file) {
              setSelectedFile(file);
              setPreviewURL(URL.createObjectURL(file));
            }
          }

          // Llamar al endpoint /ocr
          async function procesarOCR() {
            if (!selectedFile) {
              alert("No has seleccionado ninguna imagen.");
              return;
            }
            setIsLoading(true);
            setJugadas([]);
            setCamposDudosos([]);

            try {
              const formData = new FormData();
              formData.append("ticket", selectedFile);

              // NOTA: si tu back corre en la misma app, "/ocr" sirve;
              // si corre en render.com con otra URL, pon la URL completa:
              //  "https://loteria-backend-j1r3.onrender.com/ocr"
              let resp = await fetch("/ocr", {
                method: "POST",
                body: formData
              });
              let data = await resp.json();
              if (!data.success) {
                alert("Error en OCR: " + data.error);
                return;
              }
              setJugadas(data.resultado.jugadas || []);
              setCamposDudosos(data.resultado.camposDudosos || []);
              if (data.resultado.camposDudosos && data.resultado.camposDudosos.length>0) {
                alert("Algunos campos podrían ser dudosos (confianza baja).");
              }
            } catch (err) {
              alert("Error conectando con OCR: " + err.message);
            } finally {
              setIsLoading(false);
            }
          }

          // Botón "Usar Jugada" => rellena el form principal con la jugada elegida
          function usarJugada(j) {
            setFecha(j.fecha || "");
            setTrack(j.track || "");
            setTipoJuego(j.tipoJuego || "");
            setModalidad(j.modalidad || "");
            setNumeros(j.numeros || "");
            setMonto(j.montoApostado || "");
            cerrarModal();
          }

          // Render principal
          return (
            <div>
              <h2>Formulario Principal de Lotería</h2>
              <div className="field-box">
                <label>Fecha:</label>
                <input 
                  type="text" 
                  value={fecha} 
                  onChange={e=>setFecha(e.target.value)} 
                  style={{marginLeft:"0.5rem"}}
                />
              </div>
              <div className="field-box">
                <label>Track:</label>
                <input 
                  type="text" 
                  value={track} 
                  onChange={e=>setTrack(e.target.value)} 
                  style={{marginLeft:"0.5rem"}}
                />
              </div>
              <div className="field-box">
                <label>TipoJuego:</label>
                <input 
                  type="text" 
                  value={tipoJuego} 
                  onChange={e=>setTipoJuego(e.target.value)} 
                  style={{marginLeft:"0.5rem"}}
                />
              </div>
              <div className="field-box">
                <label>Modalidad:</label>
                <input 
                  type="text" 
                  value={modalidad} 
                  onChange={e=>setModalidad(e.target.value)} 
                  style={{marginLeft:"0.5rem"}}
                />
              </div>
              <div className="field-box">
                <label>Números:</label>
                <input 
                  type="text" 
                  value={numeros} 
                  onChange={e=>setNumeros(e.target.value)} 
                  style={{marginLeft:"0.5rem"}}
                />
              </div>
              <div className="field-box">
                <label>Monto:</label>
                <input 
                  type="text"
                  value={monto}
                  onChange={e=>setMonto(e.target.value)}
                  style={{marginLeft:"0.5rem"}}
                />
              </div>

              <button 
                id="generarTicket"
                style={{marginRight:"1rem", marginTop:"0.5rem"}}
              >
                Generar Ticket
              </button>

              {/* Botón para abrir el modal OCR */}
              <button 
                style={{marginTop:"0.5rem"}}
                onClick={abrirModal}
              >
                Capturar Boleto (OCR)
              </button>

              {/** MODAL (Bootstrap) **/}
              <div 
                className={"modal fade" + (showModal ? " show d-block" : "")} 
                tabIndex="-1"
                style={{backgroundColor: showModal ? "rgba(0,0,0,0.5)" : "transparent"}}
                >
                <div className="modal-dialog modal-lg">
                  <div className="modal-content">
                    <div className="modal-header">
                      <h5 className="modal-title">OCR Mistral - Subir Imagen</h5>
                      <button type="button" className="btn-close" onClick={cerrarModal}></button>
                    </div>
                    <div className="modal-body">
                      {/* Drag & Drop */}
                      <div 
                        className="drop-zone"
                        ref={dropZoneRef}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                      >
                        Arrastra aquí la imagen...
                      </div>
                      <p>O selecciona un archivo:</p>
                      <input 
                        type="file"
                        accept="image/*"
                        capture="camera"
                        onChange={handleFileChange}
                      />
                      {previewURL && <img src={previewURL} alt="preview" className="preview" />}

                      <div style={{marginTop:"1rem"}}>
                        <button onClick={procesarOCR}>Procesar OCR</button>
                      </div>
                      {isLoading && (
                        <div className="spinner">
                          <div></div><div></div><div></div>
                          <p>Analizando la imagen...</p>
                        </div>
                      )}

                      {/* Jugadas detectadas */}
                      {jugadas.length > 0 && (
                        <div style={{marginTop:"1rem"}}>
                          <h5>Jugadas Detectadas</h5>
                          {jugadas.map((jug, idx) => (
                            <div key={idx} style={{border:"1px solid #ccc", padding:"0.5rem", marginBottom:"0.5rem"}}>
                              <p>Fecha: {jug.fecha}</p>
                              <p>Track: {jug.track}</p>
                              <p>TipoJuego: {jug.tipoJuego}</p>
                              <p>Modalidad: {jug.modalidad}</p>
                              <p>Números: {jug.numeros}</p>
                              <p>Monto: {jug.montoApostado}</p>
                              <button onClick={()=>usarJugada(j)}>Usar esta jugada</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="modal-footer">
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={cerrarModal}
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {/** FIN MODAL **/}
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

/***********************************************************
 * POST /ocr - Recibe la imagen, llama Mistral, parsea,
 *            guarda en 'ticketsOCR', devuelve JSON
 ***********************************************************/
app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    // Convertir imagen a base64
    const base64Image = req.file.buffer.toString("base64");

    // Llamar a Mistral
    const mistralReq = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_base64",
        image_base64: base64Image
      }
    };

    const ocrResp = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      mistralReq,
      {
        headers: {
          "Authorization": \`Bearer \${MISTRAL_API_KEY}\`,
          "Content-Type": "application/json"
        }
      }
    );

    const ocrData = ocrResp.data;

    // Unimos texto y calculamos confianza
    let textoCompleto = "";
    let totalWords = 0;
    let sumConfidence = 0;
    if (ocrData.pages && Array.isArray(ocrData.pages)) {
      ocrData.pages.forEach(page => {
        if (page.text_md) textoCompleto += page.text_md + "\\n";
        if (page.words_confidence && Array.isArray(page.words_confidence)) {
          page.words_confidence.forEach(w => {
            totalWords++;
            sumConfidence += (w.confidence || 0);
          });
        }
      });
    }
    let avgConfidence = (totalWords>0) ? (sumConfidence / totalWords) : 1;

    // Parse heurístico: divide en líneas, detecta juego, modalidad, etc.
    let lineas = textoCompleto.split("\\n").map(l=>l.trim()).filter(Boolean);
    let jugadas = [];
    let camposDudosos = [];

    if (avgConfidence < 0.75) {
      camposDudosos = ["fecha","track","tipoJuego","modalidad","numeros","montoApostado"];
    }

    lineas.forEach(line => {
      const lower = line.toLowerCase();
      let jug = {
        fecha:null, track:null, tipoJuego:null, modalidad:null,
        numeros:null, montoApostado:null, notas:"", confianza:avgConfidence
      };

      // 1) Detectar juego
      if (lower.includes("peak3") || /\b\d{3}\b/.test(line)) {
        jug.tipoJuego = "Peak 3";
      } else if (lower.includes("win4") || /\b\d{4}\b/.test(line)) {
        jug.tipoJuego = "Win 4";
      } else if (lower.includes("venez")) {
        jug.tipoJuego = "Venezuela";
      } else if (lower.includes("doming")) {
        jug.tipoJuego = "SantoDomingo";
      } else if (lower.includes("pulito")) {
        jug.tipoJuego = "Pulito";
      } else if (lower.includes("single")) {
        jug.tipoJuego = "SingleAction";
      } else {
        jug.tipoJuego = "desconocido";
      }

      // 2) Modalidad
      if (lower.includes("combo")) jug.modalidad = "Combo";
      else if (lower.includes("box")) jug.modalidad = "Box";
      else if (lower.includes("straight")) jug.modalidad = "Straight";
      else if (lower.includes("round") || lower.includes("x")) jug.modalidad = "RoundDown";
      else jug.modalidad = "desconocido";

      // 3) Números (2-4 dígitos)
      let rgxNums = /\b(\d{2,4}X|\d{2,4})\b/g;
      let matches = line.match(rgxNums);
      if (matches && matches.length>0) {
        jug.numeros = matches.join(",");
      } else {
        jug.numeros = "ilegible";
      }

      // 4) Monto
      let rgxMonto = /\$?\d+(\\.\\d{1,2})?/;
      let mm = line.match(rgxMonto);
      if (mm) {
        let mStr = mm[0].replace("$","");
        jug.montoApostado = parseFloat(mStr);
      } else {
        jug.montoApostado = "?";
      }

      jugadas.push(jug);
    });

    // Rellenar track, fecha por defecto
    let now = new Date();
    let isoHoy = now.toISOString().slice(0,10);
    let hora = now.getHours() + now.getMinutes()/60;
    jugadas.forEach(j => {
      if (!j.fecha) j.fecha = isoHoy;
      if (!j.track) {
        j.track = (hora<14.25) ? "NY Midday" : "NY Evening";
      }
    });

    // Guardar en DB
    const col = db.collection("ticketsOCR");
    await col.insertOne({
      createdAt: new Date(),
      fullText: textoCompleto,
      avgConfidence,
      jugadas
    });

    // Devolver
    return res.json({
      success: true,
      resultado: {
        jugadas,
        camposDudosos
      }
    });

  } catch (err) {
    console.error("Error en /ocr:", err.message);
    return res.json({ success: false, error: err.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
