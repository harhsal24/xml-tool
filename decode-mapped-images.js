// decode-mapped-images.js
// Usage:
//   node decode-mapped-images.js input.txt images_folder output.txt

const fs = require("fs");
const path = require("path");
const Jimp = require("jimp");
const jsQR = require("jsqr");

// ================================================================
// QR DECODING
// ================================================================
async function decodeQRCode(imagePath) {
  if (!fs.existsSync(imagePath)) {
    return { success: false, error: "Image file not found" };
  }
  try {
    const image = await Jimp.read(imagePath);
    const { data, width, height } = image.bitmap;
    const pixelArray = Uint8ClampedArray.from(data);
    const code = jsQR(pixelArray, width, height);
    if (code && code.data) return { success: true, text: code.data };
    else return { success: false, error: "No QR code found in image" };
  } catch (err) {
    return { success: false, error: `Failed to read or decode image: ${err.message}` };
  }
}

// ================================================================
// FAILURE HANDLING
// ================================================================
function handleDecodingFailure(originalImagePath, xpath, reason) {
  try {
    const failuresDir = path.join("output", "extraction_failures");
    const imagesDir = path.join(failuresDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const newFileName = `${timestamp}-${path.basename(originalImagePath)}`;
    const destinationImagePath = path.join(imagesDir, newFileName);
    if (fs.existsSync(originalImagePath)) fs.copyFileSync(originalImagePath, destinationImagePath);
    const logMessage = `[${new Date().toLocaleString()}] ${path.basename(originalImagePath)} | ${xpath} | ${reason}\n`;
    fs.appendFileSync(path.join(failuresDir, "failure_log.txt"), logMessage);
  } catch (err) {
    console.error("Failed to handle decoding failure:", err.message);
  }
}

// ================================================================
// MAIN DECODER
// ================================================================
async function decodeFromMappingFile(mappingFilePath, imagesFolder, outputFilePath) {
  const lines = fs.readFileSync(mappingFilePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const outputLines = [];

  console.log(`Found ${lines.length} mapping lines.`);
  for (const line of lines) {
    const [left, right] = line.split(" : ");
    if (!left || !right) continue;

    const value = left.trim();
    const xpath = right.trim();
    const imageFileName = path.basename(value);
    const imagePath = path.join(imagesFolder, imageFileName);

    console.log(`\nProcessing ${imageFileName}`);

    if (!/\.(png|jpg|jpeg)$/i.test(imageFileName)) {
      // Not an image — just copy the value
      console.warn(`   Skipping non-image value: ${value}`);
      outputLines.push(`${value} : ${xpath}`);
      continue;
    }

    const result = await decodeQRCode(imagePath);
    if (result.success) {
      console.log(`   ✅ Decoded QR: ${result.text}`);
      outputLines.push(`${result.text} : ${xpath}`);
    } else {
      console.warn(`   ❌ Failed: ${result.error}`);
      handleDecodingFailure(imagePath, xpath, result.error);
      outputLines.push(`DECODING_ERROR: ${result.error} : ${xpath}`);
    }
  }

  fs.writeFileSync(outputFilePath, outputLines.join("\n"), "utf8");
  console.log(`\n✅ Decoding complete. Output saved to ${outputFilePath}`);
}

// ================================================================
// CLI
// ================================================================
async function main() {
  const [mappingFilePath, imagesFolder, outputFilePath] = process.argv.slice(2);
  if (!mappingFilePath || !imagesFolder || !outputFilePath) {
    console.error("Usage: node decode-mapped-images.js <input.txt> <images_folder> <output.txt>");
    process.exit(1);
  }
  await decodeFromMappingFile(mappingFilePath, imagesFolder, outputFilePath);
}

main();
