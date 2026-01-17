import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = 'client/public';
const LOGO_PATH = 'client/public/lyceon-logo.png';

// New Lyceon brand palette (cream/beige inspired by logo)
const CREAM_START = '#F5F0E6';
const CREAM_END = '#D8D2C4';
const NAVY = '#1f2937';
const DARK_NAVY = '#111827';

// Create OG Image (1200x630) with cream gradient background
async function createOgImage() {
  const width = 1200;
  const height = 630;
  
  // Resize logo to fit centered
  const logoSize = 180;
  const resizedLogo = await sharp(LOGO_PATH)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  
  // Create background with cream gradient and subtle grid
  const backgroundSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${CREAM_START};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${CREAM_END};stop-opacity:1" />
        </linearGradient>
        
        <!-- Subtle grid pattern -->
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="${NAVY}" stroke-width="0.3" opacity="0.06"/>
        </pattern>
      </defs>
      
      <!-- Background gradient -->
      <rect width="100%" height="100%" fill="url(#bg-gradient)"/>
      
      <!-- Subtle grid overlay -->
      <rect width="100%" height="100%" fill="url(#grid)"/>
    </svg>
  `;

  // Create text overlay with all elements
  const textSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <!-- Top-left domain -->
      <text x="40" y="50" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="22" font-weight="600" fill="${NAVY}">
        lyceon.ai
      </text>
      
      <!-- Subtitle under logo (centered) -->
      <text x="600" y="420" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="32" font-weight="500" fill="${DARK_NAVY}" text-anchor="middle">
        SAT Tutor at your Finger Tips.
      </text>
      
      <!-- Bottom-center tagline -->
      <text x="600" y="580" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="24" font-weight="400" fill="${NAVY}" text-anchor="middle" opacity="0.8">
        Practice smarter. Score higher.
      </text>
    </svg>
  `;

  // Compose the final image
  const background = await sharp(Buffer.from(backgroundSvg)).png().toBuffer();
  const textOverlay = await sharp(Buffer.from(textSvg)).png().toBuffer();
  
  // Logo position (centered horizontally, positioned above subtitle)
  const logoLeft = Math.floor((width - logoSize) / 2);
  const logoTop = 180;

  await sharp(background)
    .composite([
      { input: resizedLogo, left: logoLeft, top: logoTop },
      { input: textOverlay, left: 0, top: 0 }
    ])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, 'og-image.jpg'));
  
  console.log('✅ Created og-image.jpg (1200x630) with cream gradient background');
}

// Create Favicon assets from actual logo
async function createFavicons() {
  // Read the original logo
  const logoPng = await sharp(LOGO_PATH).png().toBuffer();
  
  // Use cream background color that harmonizes with the new palette
  const bgColor = { r: 245, g: 240, b: 230, alpha: 1 }; // #F5F0E6
  
  // Create 192px PNG (Android/PWA)
  await sharp(logoPng)
    .resize(192, 192, { fit: 'contain', background: bgColor })
    .flatten({ background: bgColor })
    .png()
    .toFile(path.join(OUTPUT_DIR, 'favicon-192.png'));
  console.log('✅ Created favicon-192.png (192x192)');
  
  // Create 32px PNG (browser tabs)
  await sharp(logoPng)
    .resize(32, 32, { fit: 'contain', background: bgColor })
    .flatten({ background: bgColor })
    .png()
    .toFile(path.join(OUTPUT_DIR, 'favicon-32.png'));
  console.log('✅ Created favicon-32.png (32x32)');
  
  // Create 16px PNG for ICO
  const favicon16 = await sharp(logoPng)
    .resize(16, 16, { fit: 'contain', background: bgColor })
    .flatten({ background: bgColor })
    .png()
    .toBuffer();
  
  // Create 32px version for ICO
  const favicon32 = await sharp(logoPng)
    .resize(32, 32, { fit: 'contain', background: bgColor })
    .flatten({ background: bgColor })
    .png()
    .toBuffer();
  
  // For ICO, we'll use 32px PNG as browsers primarily use this size
  await sharp(favicon32)
    .toFile(path.join(OUTPUT_DIR, 'favicon.ico'));
  console.log('✅ Created favicon.ico (32x32)');
}

async function main() {
  // Check if logo exists
  if (!fs.existsSync(LOGO_PATH)) {
    console.error('❌ Logo file not found at:', LOGO_PATH);
    process.exit(1);
  }
  
  console.log('🎨 Generating Lyceon brand assets with cream palette...\n');
  console.log('📁 Logo source:', LOGO_PATH);
  
  // Get logo info
  const logoMeta = await sharp(LOGO_PATH).metadata();
  console.log(`   Logo size: ${logoMeta.width}x${logoMeta.height}\n`);
  
  await createOgImage();
  await createFavicons();
  
  console.log('\n✨ All assets generated successfully!');
  console.log(`📁 Output: ${OUTPUT_DIR}/`);
}

main().catch(console.error);
