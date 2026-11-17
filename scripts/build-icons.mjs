import fs from "node:fs/promises";
import sharp from "sharp";

// Export the user's original artwork without cropping or redrawing it.
const source = "assets/app-icon-source.jpg";
const background = "#ffffff";
await fs.mkdir("public/icons", { recursive: true });

for (const [file, size, inset] of [
  ["public/apple-touch-icon.png", 180, 0],
  ["public/favicon-32.png", 32, 0],
  ["public/icons/escape-192.png", 192, 0],
  ["public/icons/escape-512.png", 512, 0],
  // Extra white space keeps the logo and lettering inside Android's safe area.
  ["public/icons/escape-512-maskable.png", 512, 72],
]) {
  const contentSize = size - inset * 2;
  await sharp(source)
    .autoOrient()
    .resize(contentSize, contentSize, { fit: "contain", background })
    .extend({
      top: inset,
      bottom: inset,
      left: inset,
      right: inset,
      background,
    })
    .flatten({ background })
    .png()
    .toFile(file);
}

console.log("App icons exported from assets/app-icon-source.jpg");
