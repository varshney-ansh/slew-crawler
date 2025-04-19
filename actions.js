import { URL } from 'url';
import puppeteer from 'puppeteer';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();
import { Site } from './schema.js';

// Getting domain from url
function getDomain(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

// const MAX_PAGES = 50;

// Open Page Rank API 
async function getDomainAuthority(domain) {
    try {
        const res = await axios.get(`${process.env.OPEN_PAGE_RANK_API}`, {
            headers: { 'API-OPR': `${process.env.OPEN_PAGE_RANK_API_KEY}` },
            params: { domains: [domain] },
            method: 'GET',
        });
        const score = res.data.response[0]?.page_rank_decimal;
        return {
            score: typeof score === 'number' ? score : null,
            rank: res.data.response[0]?.rank,
        };
    } catch (err) {
        console.warn(`Failed to fetch DA for ${domain}:`, err.message);
        return null;
    }
}

// Breadcrumb-style cite builder
function buildCite(url) {
    try {
        const parsed = new URL(url);
        const origin = parsed.origin; // e.g. https://www.example.com

        // Remove leading/trailing slashes, split path
        const pathParts = parsed.pathname
            .split('/')
            .filter(part => part.trim() !== '');

        const breadcrumb = pathParts.join(' › '); // join like breadcrumb
        return breadcrumb ? `${origin} › ${breadcrumb}` : origin;
    } catch {
        return url; // fallback if URL is invalid
    }
}

// Generate keywords from title/description
function generateKeywords(title = '', description = '') {
    const text = `${title} ${description}`.toLowerCase();
    const stopWords = new Set([
        'the', 'is', 'at', 'of', 'on', 'and', 'a', 'to', 'in', 'with', 'for', 'by', 'an', 'from', 'or'
    ]);

    return Array.from(
        new Set(
            text
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(word => word.length > 2 && !stopWords.has(word))
        )
    ).slice(0, 10);
}

// Extract metadata using Puppeteer
async function extractMetadata(page, url) {

    const metadata = await page.evaluate(() => {
        const getMeta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || null;
        const getFavicon = () => {
            const icon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
            return icon?.href || null;
        };
        const getOG = (property) => document.querySelector(`meta[property="${property}"]`)?.content || null;

        return {
            title: document.title || null,
            description: getMeta('description'),
            keywords: getMeta('keywords'),
            favicon: getFavicon(),
            siteName: getOG('og:site_name') || null
        };
    });

    // Fallback favicon URL if it's relative
    const parsed = new URL(url);
    const fullFavicon = metadata.favicon?.startsWith('http')
        ? metadata.favicon
        : metadata.favicon ? `${parsed.origin}${metadata.favicon}` : null;

    const keywords = metadata.keywords
        ? metadata.keywords.split(',').map(k => k.trim())
        : generateKeywords(metadata.title, metadata.description);

    const siteName = metadata.siteName || new URL(url).hostname.replace(/^www\./, '');

    const domain = getDomain(url);
    const domainAuthorityRes = await getDomainAuthority(domain)
    const domainAuthority = domainAuthorityRes?.score || null;
    const domainRank = domainAuthorityRes?.rank || null;

    return {
        url,
        title: metadata.title,
        description: metadata.description,
        favicon: fullFavicon,
        cite: buildCite(url),
        keywords,
        siteName,
        domain,
        authority: domainAuthority,
        rank: domainRank,
    };

}

// Normalize URL
function normalizeUrl(rawUrl) {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

// Extract internal links
async function extractLinks(page, baseDomain) {
    const rawLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'))
    );

    const cleanLinks = new Set();
    const redirectDomains = ['bit.ly', 't.co', 'goo.gl', 'tinyurl.com', 'buff.ly', 'linktr.ee', 'lnk.bio', 'rebrand.ly'];
    const badPatterns = ['redirect', 'login', 'auth', 'authorize', 'signup', 'signin'];
    const badParams = ['next', 'redirect', 'url', 'target'];

    for (const link of rawLinks) {
        try {
            const url = new URL(link);
            const path = url.pathname.toLowerCase();
            const search = url.searchParams;

            const linkDomain = url.hostname.replace(/^www\./, '');
            const base = baseDomain.replace(/^www\./, '');

            const isSubdomain = linkDomain === base || linkDomain.endsWith(`.${base}`);
            if (
                !isSubdomain ||
                url.hash ||
                redirectDomains.some(d => linkDomain.includes(d)) ||
                badPatterns.some(p => path.endsWith(`/${p}`)) ||
                badParams.some(param => search.has(param))
            ) continue;

            cleanLinks.add(normalizeUrl(link));
        } catch {
            continue;
        }
    }

    return Array.from(cleanLinks);
}

function deleteLineFromFile(filePath, matchLine) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const filtered = lines.filter(line => line.trim() !== matchLine.trim());
    fs.writeFileSync(filePath, filtered.join('\n'), 'utf-8');
}

// Crawl site recursively
export async function crawlSite(startUrl, line ,maxDepth = 2, concurrency = 3) {
    const visited = new Set();
    const toVisit = [{ url: normalizeUrl(startUrl), depth: 0 }];
    const { hostname: baseDomain } = new URL(startUrl);

    const browser = await puppeteer.launch({ headless: 'new', args: [
      '--no-sandbox',
      '--disable-gpu',
    ] , executablePath: `${process.env.EXECUTABLE_PATH_CHROME}` });

    const worker = async () => {
        const page = await browser.newPage();
        while (toVisit.length) {
            const { url, depth } = toVisit.shift();
            if (visited.has(url) || depth > maxDepth) continue;

            try {
                const existingSite = await Site.findOne({ url });
                if (existingSite) {
                    console.log(`🔄 Skipping already crawled URL: ${url}`);
                    continue;
                }

                visited.add(url);
                console.log(`🌐 [Depth ${depth}] Crawling: ${url}`);

                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

                const metadata = await extractMetadata(page, url);
                await Site.updateOne({ url: metadata.url }, { $set: metadata }, { upsert: true });
                fs.appendFileSync('success.txt', url + '\n');

                const links = await extractLinks(page, baseDomain);
                for (const link of links) {
                    const norm = normalizeUrl(link);
                    if (!visited.has(norm)) toVisit.push({ url: norm, depth: depth + 1 });
                }
            } catch (err) {
                console.warn(`❌ Failed: ${url}`, err.message);
                fs.appendFileSync('failed.txt', url + '\n');
            }
        }
        await page.close();
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    await browser.close();
    deleteLineFromFile('crawl.txt', line);
    console.log('✅ Crawling complete');
}


