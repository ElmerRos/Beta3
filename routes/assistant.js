// routes/assistant.js

/*
 * Endpoints para conversar con el Assistant de OpenAI usando memoria de threads
 * POST /api/assistant/chat  → envía texto, imágenes o audio y devuelve la respuesta
 */

const express = require('express');
const multer  = require('multer');
const { createRunWithAttachments } = require('../services/assistantService');
const Thread  = require('../models/Thread');
const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage() });

// Utilidad: obtener o crear threadId persistente
async function getThreadId(userId) {
  let doc = await Thread.findOne({ userId });
  if (!doc) doc = await new Thread({ userId, threadId: null }).save();
  return doc.threadId;
}

async function saveThreadId(userId, threadId) {
  await Thread.findOneAndUpdate(
    { userId },
    { threadId, updatedAt: Date.now() },
    { new: true, upsert: true }
  );
}

/**
 * Principal: envía mensaje + files (imagen/audio) y devuelve la respuesta del assistant
 * body:
 *   userId        → obligatorio
 *   message       → texto del usuario (puede ser '')
 *   files[] (form‑data) → imágenes o audio opcionales
 */
router.post('/chat', upload.array('files'), async (req, res) => {
  try {
    const { userId, message = '' } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    // Recuperar o crear thread
    let threadId = await getThreadId(userId);

    // Ejecutar run con service helper
    const runResult = await createRunWithAttachments({
      threadId,
      userId,
      text: message,
      files: req.files || []
    });

    // Si el thread era nuevo, guardar su id persistido
    if (!threadId) {
      threadId = runResult.threadId;
      await saveThreadId(userId, threadId);
    }

    res.json(runResult);
  } catch (err) {
    console.error('Error POST /api/assistant/chat', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
