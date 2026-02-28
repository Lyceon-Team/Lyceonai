import fs from 'fs';
import path from 'path';
import readline from 'readline';

const dirsToScan = [
    path.join(process.cwd(), 'docs/trust'),
    path.join(process.cwd(), 'content/blog')
];

const forbiddenPhrases = [
    'guaranteed',
    'official sat',
    'college board approved',
    'perfect score guaranteed'
];

async function scanDirs() {
    let hasForbidden = false;

    for (const dir of dirsToScan) {
        if (!fs.existsSync(dir)) continue;

        const files = fs.readdirSync(dir, { recursive: true });

        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (!fs.statSync(fullPath).isFile()) continue;

            const fileStream = fs.createReadStream(fullPath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            let lineNum = 1;
            for await (const line of rl) {
                const lowerLine = line.toLowerCase();
                for (const phrase of forbiddenPhrases) {
                    if (lowerLine.includes(phrase)) {
                        console.error(`${fullPath}:${lineNum} contains forbidden phrase: "${phrase}"`);
                        hasForbidden = true;
                    }
                }
                lineNum++;
            }
        }
    }

    if (hasForbidden) {
        console.error('Claims guard failed: Forbidden phrases found.');
        process.exit(1);
    } else {
        console.log('Claims guard passed: No forbidden drift detected.');
    }
}

scanDirs().catch(err => {
    console.error(err);
    process.exit(1);
});
