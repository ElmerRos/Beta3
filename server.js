/************************************************
 * server.js
 ************************************************/
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const app = express();

// ========== TU URI de Mongo (ENV var) ==========
const MONGODB_URI = process.env.MONGODB_URI 
  || "mongodb+srv://BeastBetTwo:Amiguito2468@beastbet.lleyk.mongodb.net/beastbetdb?retryWrites=true&w=majority&appName=Beastbet";

mongoose.connect(MONGODB_URI, {
  useNewUrlParser:true, 
  useUnifiedTopology:true
}).then(()=>{
  console.log("Conectado a Mongo OK");
}).catch(err=>{
  console.error("Error conectando a Mongo:",err);
});

// ========== SCHEMA/MODEL ==========
// usaremos un doc para cada code => { code, data }
const beastSchema = new mongoose.Schema({
  code: { type:String, required:true },
  data: { type:Object, required:true }
}, 
{ collection:"generic_collection" }); 
// Puedes cambiar "generic_collection" por un nombre más genérico.
// Cada doc se distinguirá por 'code'. 

const BeastModel = mongoose.model("BeastModel", beastSchema);

// ========== LISTA DE CÓDIGOS VÁLIDOS (PERMUTACIONES) ==========
const validCodes = [
  "2468","2486","2648","2684","2846","2864",
  "4268","4286","4628","4682","4826","4862",
  "6248","6284","6428","6482","6824","6842",
  "8246","8264","8426","8462","8624","8642"
];

// Config para parsear JSON 
app.use(express.json({limit:"10mb"}));

// Servimos el contenido estático de la carpeta "public" 
// (allí pondremos dailyReports.html)
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
    res.json({ notFound:false, data: doc.data });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Error interno" });
  }
});

app.post("/api/reportes_:code", async (req,res)=>{
  const code = req.params.code;
  if(!validCodes.includes(code)){
    return res.status(400).json({ error:"Código inválido" });
  }
  let newData = req.body; // { weeks: [...], etc. }
  try{
    let doc = await BeastModel.findOneAndUpdate(
      { code },
      { code, data:newData },
      { upsert:true, new:true }
    );
    res.json({ ok:true });
  }catch(e){
    console.error(e);
    return res.status(500).json({ error:"Error al guardar en Mongo" });
  }
});

// Puerto
const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, ()=>{
  console.log("Server on port", PORT);
  console.log("Visita http://localhost:"+PORT+"/dailyReports.html para ver la app");
});
