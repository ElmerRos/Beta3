// models/Thread.js

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Esquema para almacenar threads de OpenAI Assistant por usuario.
 * userId: identificador único del usuario en tu sistema (puede ser string o ObjectId).
 * threadId: ID retornado por OpenAI para reutilizar conversaciones.
 * metadata: cualquier dato adicional (fecha de último uso, etc.).
 */
const ThreadSchema = new Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  threadId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
});

// Middleware para actualizar updatedAt
ThreadSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Thread', ThreadSchema);
