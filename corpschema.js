import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
    wikidataId: { type: String, unique: true },
    name: String,
    website: String,
    ceo: String,
    founded: Date,
    industry: String,
    parent: String,
    hq: String,
    logo: String,
    hqImage: String,
    revenue: String,
    netIncome: String,
    founders: [String],
    subsidiaries: [String],
    wikipediaLink: String
});


export const CorpWikiInfo = mongoose.model('CorpWikiInfo', companySchema);