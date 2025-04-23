// models/Thread.js

const mongoose = require('mongoose');
const { Schema } = mongoose;

const ThreadSchema = new Schema({
  userId: { type: String, required: true, index: true },
  threadId: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  metadata: { type: Schema.Types.Mixed, default: {} }
});

ThreadSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Thread', ThreadSchema);
