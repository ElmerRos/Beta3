/**
 * routes/ocr.js
 * ------------------------------------------------------------------
 * Router Express que expone POST /api/ocr
 *  - Recibe una imagen (FormData field «ticket»)
 *  - Invoca al servicio OCR (OpenAI → Google Vision fallback)
 *  - Devuelve JSON normalizado   { success, metodo, resultado, debug }
 * ------------------------------------------------------------------
 */

"use strict";

const express  = require("express");
const multer   = require("multer");
const sharp    = require("sharp");

const ocrService = require("../services/ocrService");

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage() });

/** ─────────────────────────────────────────────
 *  Helper: limita tamaño y tipo MIME
 *  (evita subir PDF o imágenes enormes)
 */
function validateFile(file) {
  const MAX_MB = 5;
  const allowed = /^image\/(jpeg|png|webp)$/i;

  if (!file) throw new Error("No se recibió archivo ‘ticket’");
  if (!allowed.test(file.mimetype))
    throw new Error("Solo se permiten imágenes JPEG, PNG o WEBP");
  if (file.size > MAX_MB * 1024 * 1024)
    throw new Error(`La imagen supera ${MAX_MB} MB`);
}

/** ─────────────────────────────────────────────
 *  POST  /api/ocr
 *  Campo FormData = ticket (image/*)
 */
router.post("/", upload.single("ticket"), async (req, res) => {
  try {
    validateFile(req.file);

    /**
     * Redimensionamos aquí para no cargar el servicio
     * con una imagen gigante (2000 px máx.)
     */
    const resizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 2000, height: 2000, fit: "inside" })
      .toBuffer();

    const ocrResult = await ocrService.processImage({
      buffer: resizedBuffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    return res.json({ success: true, ...ocrResult });
  } catch (err) {
    console.error("[/api/ocr]", err.message);
    return res.json({ success: false, error: err.message });
  }
});

module.exports = router;
