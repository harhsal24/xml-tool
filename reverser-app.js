const fs = require('fs');
const path = require('path');
const readline = require('readline');

function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

function createCommonBlock(originalXpath) {
    const uadXpath = originalXpath;
    const cleanXpath = originalXpath.replace(/$$[^$$]+\]/g, '');
    const parts = cleanXpath.substring(1).split('/');

    // --- THIS IS THE MODIFIED LINE ---
    // We now add the '.1' suffix to the tag name itself.
    const aciTagName = parts[parts.length - 1] + '.1';

    const pathOnlyParts = parts.slice(0, -1);
    const aciTagPath = `\\${pathOnlyParts.join('\\')}\\`;

    // The logic for ACI_Tag is now simpler, as it's just the path + the new ACI_TagName
    const aciTag = cleanXpath.substring(1).replace(/\//g, '\\') + '.1';
    
    const aciTagIsCheckbox = 'false';

    return `  <common>
    <ACI_TagPath>${escapeXml(aciTagPath)}</ACI_TagPath>
    <ACI_TagName>${escapeXml(aciTagName)}</ACI_TagName>
    <ACI_Tag>${escapeXml(aciTag)}</ACI_Tag>
    <ACI_TagIsCheckbox>${escapeXml(aciTagIsCheckbox)}</ACI_TagIsCheckbox>
    <UAD_Xpath>${escapeXml(uadXpath)}</UAD_Xpath>
  </common>`;
}


// --- Interactive Console Logic (Unchanged) ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log("--- Welcome to the XML Reverser App ---");
    const inputFilename = await askQuestion('Enter the path to your input .txt file (e.g., output/stores.txt): ');
    const inputPath = path.resolve(inputFilename);
    if (!fs.existsSync(inputPath)) {
        console.error(`✖ Error: Input file not found at ${inputPath}`);
        rl.close();
        return;
    }
    const defaultOutput = 'output/mapping.xml';
    const outputPath = await askQuestion(`Enter the path for your new output XML file (press Enter for default: ${defaultOutput}): `) || defaultOutput;
    try {
        console.log("\nReading input file and processing...");
        const fileContent = fs.readFileSync(inputPath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        const commonBlocks = [];
        for (const line of lines) {
            const parts = line.split(' : ');
            if (parts.length === 2) {
                const xpath = parts[1].trim();
                commonBlocks.push(createCommonBlock(xpath));
            } else {
                console.warn(`Skipping malformed line: ${line}`);
            }
        }
        const finalXml = `<MappingData>\n${commonBlocks.join('\n')}\n</MappingData>`;
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(outputPath, finalXml, 'utf8');
        console.log(`\n✔ Success! Generated ${commonBlocks.length} records.`);
        console.log(`Output written to: ${outputPath}`);
    } catch (error) {
        console.error(`\n✖ An error occurred during processing: ${error.message}`);
    } finally {
        rl.close();
    }
}

main();