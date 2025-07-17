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

/**
 * Creates a single <common> XML block based on the two parts of an input line.
 * Returns null if the block should be skipped.
 * @param {string} aciValue The string before the ':', e.g., "URAR\SUBJECT\ADDRESS\CITY.1"
 * @param {string} uadXpath The string after the ':', e.g., "/URAR_FORM/SUBJECT/ADDRESS/CITY"
 * @returns {string|null} The formatted <common> XML block as a string, or null to skip.
 */
function createCommonBlock(aciValue, uadXpath) {
    // First, handle the special 'true'/'false' case. This rule takes precedence.
    if (aciValue === 'true' || aciValue === 'false') {
        return `  <common>
    <UAD_Xpath>${escapeXml(uadXpath)}</UAD_Xpath>
  </common>`;
    }

    // --- NEW LOGIC: Skip the line if it doesn't start with "URAR" ---
    if (!aciValue.startsWith('URAR')) {
        // Return null to signify that this line should be skipped.
        return null;
    }

    // --- EXISTING LOGIC: Runs only for lines that start with "URAR" ---
    const uadXpathTag = uadXpath;
    const aciTag = aciValue;

    const aciParts = aciTag.split('\\');
    const aciTagName = aciParts[aciParts.length - 1];
    
    const pathParts = aciParts.slice(0, -1);
    const aciTagPath = `\\${pathParts.join('\\')}\\`;
    const aciTagIsCheckbox = 'false';

    return `  <common>
    <ACI_TagPath>${escapeXml(aciTagPath)}</ACI_TagPath>
    <ACI_TagName>${escapeXml(aciTagName)}</ACI_TagName>
    <ACI_Tag>${escapeXml(aciTag)}</ACI_Tag>
    <ACI_TagIsCheckbox>${escapeXml(aciTagIsCheckbox)}</ACI_TagIsCheckbox>
    <UAD_Xpath>${escapeXml(uadXpathTag)}</UAD_Xpath>
  </common>`;
}


// --- Interactive Console Logic (with a small change in the loop) ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log("--- Welcome to the XML Reverser App ---");
    const inputFilename = await askQuestion('Enter the path to your input .txt file: ');
    const inputPath = path.resolve(inputFilename);
    if (!fs.existsSync(inputPath)) {
        console.error(`✖ Error: Input file not found at ${inputPath}`);
        rl.close();
        return;
    }
    const defaultOutput = 'output/mapping.xml';
    const outputPath = await askQuestion(`Enter the path for your new output XML file (default: ${defaultOutput}): `) || defaultOutput;
    try {
        console.log("\nReading input file and processing...");
        const fileContent = fs.readFileSync(inputPath, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');
        const commonBlocks = [];
        let skippedCount = 0;
        
        for (const line of lines) {
            const parts = line.split(' : ');
            if (parts.length === 2) {
                const aciValue = parts[0].trim();
                const uadXpath = parts[1].trim();
                
                // --- MODIFIED LOGIC: Check the result before adding it ---
                const block = createCommonBlock(aciValue, uadXpath);
                if (block) {
                    // Only add the block to the array if it's not null.
                    commonBlocks.push(block);
                } else {
                    skippedCount++;
                }

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
        if (skippedCount > 0) {
            console.log(`(Skipped ${skippedCount} records that did not start with 'URAR'.)`);
        }
        console.log(`Output written to: ${outputPath}`);
    } catch (error) {
        console.error(`\n✖ An error occurred during processing: ${error.message}`);
    } finally {
        rl.close();
    }
}

main();