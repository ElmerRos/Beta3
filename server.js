 /************************************************
 * server.js - Ejemplo con require("./index.js")
 ************************************************/
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");

// Si tu index.js está en la misma carpeta que server.js:
require("./index.js"); 
// Con esto, se carga y ejecuta todo el contenido de index.js. 
// Así no pierdes la funcionalidad que tenías allí.

// ========== Tu URI de Mongo (ENV var) ==========
const MONGODB_URI = process.env.MONGODB_URI 
  || "mongodb+srv://BeastBetTwo:Amiguito2468@beastbet.lleyk.mongodb.net/beastbetdb?retryWrites=true&w=majority&appName=Beastbet";

// Conectamos Mongoose a la URI
mongoose.connect(MONGODB_URI, {
  useNewUrlParser:true, 
  useUnifiedTopology:true
}).then(()=>{
  console.log("Conectado a Mongo OK");
}).catch(err=>{
  console.error("Error conectando a Mongo:", err);
});

// ========== SCHEMA/MODEL ==========
// Ejemplo: un doc por cada code => { code, data }
const beastSchema = new mongoose.Schema({
  code: { type:String, required:true },
  data: { type:Object, required:true }
}, 
{ collection:"generic_collection" }); 
// Cambia "generic_collection" si prefieres otro nombre.

const BeastModel = mongoose.model("BeastModel", beastSchema);

// ========== LISTA DE CÓDIGOS VÁLIDOS (PERMUTACIONES) ==========
const validCodes = [
  "2468","2486","2648","2684","2846","2864",
  "4268","4286","4628","4682","4826","4862",
  "6248","6284","6428","6482","6824","6842",
  "8246","8264","8426","8462","8624","8642"
];

// Iniciamos Express
const app = express();
app.use(express.json({limit:"10mb"}));

// Servimos estáticos desde la carpeta "public":
app.use(express.static("public"));

/************************************************
 * RUTAS GET/POST => /api/reportes_{code}
 ************************************************/
app.get("/api/reportes_:code", async (req,res)=>{
  const code = req.params.code;
  if(!validCodes.includes(code)){
    return res.status(400).json({ error:"Código inválido" });
  }
  try{
    let doc = await BeastModel.findOne({ code }).exec();
    if(!doc){
      return res.json({ notFound:true, data:null });
    }
    return res.json({ notFound:false, data: doc.data });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Error interno al leer de Mongo" });
  }
});

app.post("/api/reportes_:code", async (req,res)=>{
  const code = req.params.code;
  if(!validCodes.includes(code)){
    return res.status(400).json({ error:"Código inválido" });
  }
  let newData = req.body; // { weeks: [...], etc. }
  try{
    // upsert: si no existe, lo crea.
    let doc = await BeastModel.findOneAndUpdate(
      { code },
      { code, data:newData },
      { upsert:true, new:true }
    );
    return res.json({ ok:true });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Error al guardar en Mongo" });
  }
});

// Puerto
const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, ()=>{
  console.log("=====================================");
  console.log("Servidor corriendo en puerto", PORT);
  console.log("Visita http://localhost:"+PORT+"/dailyReport.html");
  console.log("o la URL que Render asigne (p.ej. https://beasreaderbeta3.onrender.com/dailyReport.html)");
  console.log("=====================================");
});
