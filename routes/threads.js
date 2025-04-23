 // routes/threads.js

const express = require('express');
const Thread = require('../models/Thread');
const router = express.Router();

/**
 * 1) Obtener o crear un registro de thread por usuario
 *    POST /api/threads  { userId }
 *    →  { threadId }  (puede ser null la primera vez)
 */
router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    let thread = await Thread.findOne({ userId });
    if (!thread) {
      thread = new Thread({ userId, threadId: null });
      await thread.save();
    }
    res.json({ threadId: thread.threadId });
  } catch (err) {
    console.error('Error POST /api/threads', err);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * 2) Actualizar el threadId cuando crees uno nuevo en OpenAI
 *    PATCH /api/threads/:userId  { threadId }
 *    →  { threadId }
 */
router.patch('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { threadId } = req.body;
    if (!threadId) return res.status(400).json({ error: 'threadId is required' });

    const thread = await Thread.findOneAndUpdate(
      { userId },
      { threadId, updatedAt: Date.now() },
      { new: true, upsert: true }
    );
    res.json({ threadId: thread.threadId });
  } catch (err) {
    console.error('Error PATCH /api/threads/:userId', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
