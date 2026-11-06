import sharp from 'sharp';

const input = new URL('../assets/dailyspotlight.svg', import.meta.url);
const output = new URL('../assets/dailyspotlight.png', import.meta.url);
await sharp(input.pathname).png().toFile(output.pathname);
console.log('Rendered assets/dailyspotlight.png (1280 × 720).');