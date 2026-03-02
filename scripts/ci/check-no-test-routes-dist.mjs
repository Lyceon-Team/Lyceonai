import fs from 'fs';
import path from 'path';

const distDir = path.join(process.cwd(), 'dist');

let foundTestRoutes = false;

function scanDirectory(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            scanDirectory(fullPath);
        } else if (entry.isFile() && fullPath.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');

            // Look for string literals '__test' or '/__test' (excluding comments or false positives like import paths if they are actually eliminated)
            // Since it's a bundled built file, we check for presence of "__test".
            // To avoid false positives on words like "__testing", we check for "__test"
            if (content.includes('__test') || content.includes('/__test')) {
                console.error(`ERROR: Found '__test' reference in production bundle: ${fullPath}`);
                foundTestRoutes = true;
            }
        }
    }
}

console.log('Scanning dist/ for test routes...');
scanDirectory(distDir);

if (foundTestRoutes) {
    console.error('\nFAILED: Test routes or test references were found in dist files.');
    console.error('Test routes must not be included in the production build.');
    process.exit(1);
} else {
    console.log('\nOK: No test routes found in dist/');
    process.exit(0);
}
