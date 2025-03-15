 "use strict";

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const sharp = require("sharp");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "TU_API_KEY_MISTRAL";

app.use(express.static("public"));

app.post("/ocr", upload.single("ticket"), async (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: "No se recibió ninguna imagen." });
  }

  try {
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    const base64Str = resizedBuffer.toString("base64");
    // Por si tuviéramos PNG/JPEG
    let mimeType = "image/png";
    if (req.file.mimetype === "image/jpeg") mimeType = "image/jpeg";

    const mistralPayload = {
      model: "mistral-ocr-latest",
      document: {
        type: "image_url",
        image_url: `data:${mimeType};base64,${base64Str}`
      }
      // NO instructions
    };

    const respMistral = await axios.post(
      "https://api.mistral.ai/v1/ocr",
      mistralPayload,
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Si llega aquí, no hubo 422
    return res.json({
      success: true,
      data: respMistral.data
    });

  } catch (err) {
    console.error("Error en /ocr:", err.message);
    return res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
