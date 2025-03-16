 "use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const sharp = require("sharp");
const { MongoClient } = require("mongodb");

// Ajusta
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://user:pass@cluster/db";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Assistant ID + Org
const ASSISTANT_ID = "asst_iPQIGQRDCf1YeQ4P3p9ued6W";
const OPENAI_ORG_ID = "org-16WwdoiZ4EncYTJ278q6TQoF"; // si hace falta

// Conectar Mongo
let db = null;
(async ()=>{
  try {
    const client = await new MongoClient(MONGODB_URI, { useUnifiedTopology:true }).connect();
    db = client.db();
    console.log("Conectado a Mongo => 'ticketsOCR'");
  } catch(e){
    console.error("Error conectando a Mongo:", e);
  }
})();

// Servir public
app.use(express.static("public"));

app.get("/", (req,res)=> {
  res.sendFile(path.join(__dirname,"public","index.html"));
});

/**
 * RUTA /ocr
 * 1) Redimensionar imagen.
 * 2) Subir /v1/files => con "purpose":"assistants".
 * 3) Crear run => /v1/threads/runs con messages:
 *    => type:"image_file", image_file:{ file_id, filename }
 * 4) Esperar status completed
 * 5) GET /threads/{threadId}/messages => role="assistant"
 * 6) Parse JSON => jugadas...
 */
app.post("/ocr", upload.single("ticket"), async(req,res)=>{
  if(!req.file){
    return res.json({ success:false, error:"No se recibió ninguna imagen" });
  }
  if(!OPENAI_API_KEY){
    return res.json({ success:false, error:"No hay OPENAI_API_KEY" });
  }

  try {
    console.log("---- /ocr ----");
    console.log("Imagen:", req.file.originalname, "size:", req.file.size);

    // 1) Redimensionar
    const resizedBuf = await sharp(req.file.buffer)
      .resize({ width:2000, height:2000, fit:"inside" })
      .toBuffer();

    // 2) Subir /v1/files => multipart
    const formData = new FormData();
    formData.append("purpose", "assistants"); 
      // NOTA: "vision" podría servir si la doc lo permite
    formData.append("file", resizedBuf, {
      filename: req.file.originalname || "ticket.jpeg",
      contentType: req.file.mimetype
    });

    const fileResp = await axios.post(
      "https://api.openai.com/v1/files",
      formData,
      {
        headers:{
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta":"assistants=v2",
          "OpenAI-Organization": OPENAI_ORG_ID,
          ...formData.getHeaders()
        }
      }
    );
    console.log("fileResp =>", fileResp.data);
    const fileId = fileResp.data.id;  // "file-xxx"

    // 3) Crear Run => /v1/threads/runs
    const runResp = await axios.post(
      "https://api.openai.com/v1/threads/runs",
      {
        assistant_id: ASSISTANT_ID,
        thread:{
          messages:[
            {
              role:"user",
              content:[
                {
                  type:"text",
                  text:"Por favor, analiza este ticket y devuélveme JSON."
                },
                {
                  type:"image_file",
                  image_file:{
                    file_id:fileId,
                    filename:req.file.originalname || "ticket.jpeg"
                  }
                }
              ]
            }
          ]
        },
        // Forzar JSON
        response_format:{ type:"json_object" }
      },
      {
        headers:{
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta":"assistants=v2",
          "OpenAI-Organization":OPENAI_ORG_ID,
          "Content-Type":"application/json"
        }
      }
    );

    const runData = runResp.data;
    console.log("Run =>", JSON.stringify(runData,null,2));

    let runId = runData.id;
    let threadId = runData.thread_id;
    let status = runData.status;
    const finalStates = new Set(["completed","failed","incomplete","cancelled","cancelling","expired"]);

    // 4) Esperar
    while(!finalStates.has(status)){
      console.log(`Run status = ${status} => Esperando 1s...`);
      await new Promise(r=>setTimeout(r,1000));
      let check = await axios.get(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers:{
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta":"assistants=v2",
            "OpenAI-Organization":OPENAI_ORG_ID
          }
        }
      );
      status = check.data.status;
    }

    if(status!=="completed"){
      return res.json({
        success:false,
        error:`El run finalizó en estado ${status}`
      });
    }

    // 5) GET messages
    const msgsResp = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/messages?order=desc`,
      {
        headers:{
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta":"assistants=v2",
          "OpenAI-Organization":OPENAI_ORG_ID
        }
      }
    );
    let allMessages = msgsResp.data.data;
    console.log("Mensajes =>", JSON.stringify(allMessages,null,2));

    const assistantMsg = allMessages.find(m=> m.role==="assistant");
    if(!assistantMsg){
      return res.json({ success:false, error:"No se encontró la respuesta del assistant" });
    }

    // 6) Parse JSON
    let rawContent = assistantMsg.content || "";
    let jugadas=[];
    let camposDudosos=[];

    if(typeof rawContent==="string"){
      try{
        let obj = JSON.parse(rawContent);
        if(Array.isArray(obj)){
          jugadas=obj;
        } else if(Array.isArray(obj.jugadas)){
          jugadas=obj.jugadas;
          camposDudosos=obj.camposDudosos||[];
        } else {
          jugadas=[obj];
        }
      } catch(e){
        console.warn("No parse JSON =>", rawContent);
      }
    } else if(typeof rawContent==="object"){
      if(Array.isArray(rawContent.jugadas)){
        jugadas=rawContent.jugadas;
        camposDudosos=rawContent.camposDudosos||[];
      } else {
        jugadas=[rawContent];
      }
    }

    // Guardar en Mongo
    if(db){
      await db.collection("ticketsOCR").insertOne({
        createdAt:new Date(),
        rawAssistantOutput:rawContent,
        jugadas,
        camposDudosos
      });
    }

    // 7) Responder
    return res.json({
      success:true,
      resultado:{ jugadas, camposDudosos },
      debug:{
        runId,
        threadId,
        runStatus: status,
        rawOcr: rawContent
      }
    });

  } catch(err){
    console.error("Error en /ocr =>", err.message);
    if(err.response && err.response.data){
      console.error("err.response.data =>", JSON.stringify(err.response.data,null,2));
    }
    return res.json({
      success:false,
      error: err.response?.data?.error?.message || err.message
    });
  }
});

app.listen(PORT, ()=>{
  console.log("Servidor corriendo en puerto", PORT);
});
