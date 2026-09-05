import mongoose from 'mongoose';

const replacementSchema = new mongoose.Schema({ from: String, to: String }, { _id: false });
const channelSchema = new mongoose.Schema({ chatId: { type: String, required: true }, title: String }, { _id: false });

export const Settings = mongoose.model('Settings', new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  channels: { type: [channelSchema], default: [] },
  selectedChannelId: String,
  publicUsername: String,
  backupUsername: String,
  howToDownloadUrl: String,
  replacements: { type: [replacementSchema], default: [] },
  flow: { type: String, default: null },
  flowData: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true }));

export const Draft = mongoose.model('Draft', new mongoose.Schema({
  ownerId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['text', 'photo', 'video', 'document', 'animation'], required: true },
  fileId: String,
  text: { type: String, default: '' },
  entities: { type: [mongoose.Schema.Types.Mixed], default: [] },
  downloadUrl: String,
  targetChannelId: String,
  status: { type: String, enum: ['waiting_link', 'ready', 'sent'], default: 'waiting_link' }
}, { timestamps: true }));

export const Administrator = mongoose.model('Administrator', new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  addedBy: String
}, { timestamps: true }));
