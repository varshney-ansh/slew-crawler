import mongoose from 'mongoose';

const siteSchema = new mongoose.Schema({
    url: { type: String, unique: true },
    title: String,
    description: String,
    favicon: String,
    cite: String,
    siteName: String,
    keywords: [String],
    domain: String,
    authority: Number,
    rank: Number,
}, { timestamps: true });

// siteSchema.index({ url: 1 }, { unique: true });
export const Site = mongoose.model('Site', siteSchema);