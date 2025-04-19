import axios from 'axios';
import fs from 'fs';
import pLimit from 'p-limit';
import { CorpWikiInfo } from './corpschema.js';
import { connectDB } from './db-connect.js';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

const delay = ms => new Promise(res => setTimeout(res, ms));
const totalCompanies = 1000000;
const BATCH_SIZE = 200;
const CONCURRENCY_LIMIT = 10;
const maxRetries = 5;

async function fetchCompanyList(offset = 0, limit = BATCH_SIZE) {
    const query = `
    SELECT ?company ?companyLabel ?website
    WHERE {
      ?company wdt:P31 wd:Q4830453.
      OPTIONAL { ?company wdt:P856 ?website. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}
    OFFSET ${offset}
  `;

    const res = await axios.get(SPARQL_ENDPOINT, {
        params: {
            query,
            format: 'json'
        },
        headers: { 'User-Agent': 'SlewBot/1.0 (botinfo@slew.me)' }
    });

    return res.data.results.bindings.map((entry) => {
        const id = entry.company.value.split('/').pop();
        if (!id) return null; // Skip if no valid ID
        return {
            wikidataId: id,
            name: entry.companyLabel?.value,
            website: entry.website?.value || ''
        };
    }).filter(Boolean); // Remove nulls
}

async function fetchCompanyDetails(id) {
    const query = `
    SELECT ?ceoLabel ?founded ?industryLabel ?parentLabel ?hqLabel ?logo ?hqImage ?revenue ?netIncome
           (GROUP_CONCAT(DISTINCT ?founderLabel; separator=", ") AS ?founders)
           (GROUP_CONCAT(DISTINCT ?subsidiaryLabel; separator=", ") AS ?subsidiaries)
    WHERE {
      VALUES ?company { wd:${id} }

      OPTIONAL { ?company wdt:P169 ?ceo. }
      OPTIONAL { ?company wdt:P571 ?founded. }
      OPTIONAL { ?company wdt:P452 ?industry. }
      OPTIONAL { ?company wdt:P749 ?parent. }
      OPTIONAL { ?company wdt:P159 ?hq. }
      OPTIONAL { ?company wdt:P112 ?founder. }
      OPTIONAL { ?company wdt:P355 ?subsidiary. }
      OPTIONAL { ?company wdt:P154 ?logo. }
      OPTIONAL { ?company wdt:P18 ?image. }
      OPTIONAL {
     ?wikipediaArticle schema:about ?company;
                       schema:isPartOf ?wikiSite.
     FILTER CONTAINS(STR(?wikiSite), "wikipedia.org")
   }
      OPTIONAL {
        ?company wdt:P159 ?hq.
        ?hq wdt:P18 ?hqImage.
      }
      OPTIONAL { ?company wdt:P2139 ?revenue. }
      OPTIONAL { ?company wdt:P2295 ?netIncome. }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?ceoLabel ?founded ?industryLabel ?parentLabel ?hqLabel ?logo ?hqImage ?revenue ?netIncome ?wikipediaArticle ?image
  `;

    const res = await axios.get(SPARQL_ENDPOINT, {
        params: { query, format: 'json' },
        headers: { 'User-Agent': 'SlewBot/1.0 (botinfo@slew.me)' }
    });

    const resu = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks/urls&ids=${id}`);
    const resl = await resu.json();

    const data = res.data.results.bindings[0] || {};
    return {
        ceo: data.ceoLabel?.value,
        founded: data.founded?.value,
        industry: data.industryLabel?.value,
        parent: data.parentLabel?.value,
        hq: data.hqLabel?.value,
        logo: data.logo?.value,
        hqImage: data.image?.value,
        revenue: data.revenue?.value,
        netIncome: data.netIncome?.value,
        founders: data.founders?.value ? data.founders.value.split("||") : [],
        subsidiaries: data.subsidiaries?.value ? data.subsidiaries.value.split("||") : [],
        wikipediaLink: resl.entities?.[id]?.sitelinks?.enwiki?.url || null,
    };
}

async function saveCompany(data) {
    if (!data.wikidataId) {
        console.warn('⚠️ Skipping save due to missing wikidataId');
        return;
    }
    await CorpWikiInfo.updateOne(
        { wikidataId: data.wikidataId },
        { $set: data },
        { upsert: true }
    );
}

async function crawlBatch(offset) {
    const companies = await fetchCompanyList(offset);
    const limit = pLimit(CONCURRENCY_LIMIT); // Set concurrency limit for requests
    const failed = [];

    await Promise.all(
        companies.map(c =>
            limit(async () => {
                try {
                    const extra = await fetchCompanyDetails(c.wikidataId);
                    await saveCompany({ ...c, ...extra });
                    console.log(`✅ Saved: ${c.name}`);
                } catch (err) {
                    failed.push(c.wikidataId);
                    fs.appendFileSync('failed_companies.txt', `${c.wikidataId}\n`);
                    console.error(`❌ Failed: ${c.name} - ${err.message}`);
                }
                await delay(500); // Slight delay between requests
            })
        )
    );

    console.log(`Batch at offset ${offset} complete. ${failed.length} failed.`);
    return failed;
}

async function run() {
    await connectDB();

    const totalCompanies = 1000000; // We are going for 1M+ companies
    const batchSize = BATCH_SIZE;
    const maxRetries = 5;  // Retry failed companies up to 5 times
    let offset = 44000;
    let failedCompanies = [];

    while (offset < totalCompanies) {
        console.log(`Crawling batch starting at offset ${offset}...`);

        let retries = 0;
        let failedThisBatch;

        while (retries < maxRetries) {
            failedThisBatch = await crawlBatch(offset);
            if (failedThisBatch.length === 0) break;

            console.log(`Retrying failed batch (${retries + 1}/${maxRetries})...`);
            retries++;
            await delay(5000);  // Retry delay
        }

        // Write failed companies to the file
        failedCompanies.push(...failedThisBatch);

        offset += batchSize;
        await delay(1000); // Delay between batches
    }

    console.log(`Crawl complete. Total failed: ${failedCompanies.length}`);
}

run();
