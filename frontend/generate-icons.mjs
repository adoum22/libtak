import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const sourceIcon = path.join(__dirname, 'source-icon.png');
const outputDir = path.join(__dirname, 'public', 'icons');

async function generateIcons() {
    // Create output directory if it doesn't exist
    if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
    }

    console.log('🎨 Generating PWA icons...\n');

    for (const size of sizes) {
        const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);

        await sharp(sourceIcon)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 15, g: 23, b: 42, alpha: 1 } // #0f172a
            })
            .png()
            .toFile(outputPath);

        console.log(`✅ Created: icon-${size}x${size}.png`);
    }

    console.log('\n🎉 All icons generated successfully!');
    console.log(`📁 Output directory: ${outputDir}`);
}

generateIcons().catch(console.error);
