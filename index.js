import fs from 'fs';
import { crawlSite } from './actions.js';
import readline from 'readline';
import { connectDB } from './db-connect.js';

async function CrawlWebsites() {
    const fileStream = fs.createReadStream('crawl.txt', 'utf8');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const maxConcurrent = 2; // Adjust this value as needed
    const tasks = new Set();

    for await (const line of rl) {
        const task = crawlSite(`https://${line}/`, line).then(() => tasks.delete(task));
        tasks.add(task);

        if (tasks.size >= maxConcurrent) {
            await Promise.race(tasks);
        }
    }

    await Promise.all(tasks);
    console.log('Finished reading the file.');
}

await connectDB();
await CrawlWebsites();