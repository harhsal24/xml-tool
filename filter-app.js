const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

// Helper function to escape XML characters
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

// Function to parse the text file and extract XPaths
function parseTextFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    const xpaths = new Set();
    
    lines.forEach(line => {
        const parts = line.split(' : ');
        if (parts.length === 2) {
            const xpath = parts[1].trim();
            xpaths.add(xpath);
        }
    });
    
    return xpaths;
}

// Function to parse XML and filter common blocks
function filterCommonBlocks(xmlPath, xpathSet) {
    const xmlContent = fs.readFileSync(xmlPath, 'utf8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');
    
    const errorNode = doc.getElementsByTagName('parsererror');
    if (errorNode.length > 0) {
        throw new Error('XML Parsing Error: ' + new XMLSerializer().serializeToString(errorNode[0]));
    }
    
    const commonBlocks = doc.getElementsByTagName('common');
    const filteredBlocks = [];
    let matchedCount = 0;
    
    for (let i = 0; i < commonBlocks.length; i++) {
        const block = commonBlocks[i];
        const uadXpathNodes = block.getElementsByTagName('UAD_Xpath');
        
        if (uadXpathNodes.length > 0) {
            const uadXpathValue = uadXpathNodes[0].textContent;
            
            // Check if this XPath is in our set
            if (xpathSet.has(uadXpathValue)) {
                // Serialize the entire common block
                const serializer = new XMLSerializer();
                const blockXml = serializer.serializeToString(block);
                filteredBlocks.push(blockXml);
                matchedCount++;
            }
        }
    }
    
    return { filteredBlocks, matchedCount, totalBlocks: commonBlocks.length };
}

// Function to create the output XML
function createOutputXml(filteredBlocks) {
    // Format the blocks with proper indentation
    const formattedBlocks = filteredBlocks.map(block => {
        // Add proper indentation to the block
        return '  ' + block.replace(/\n/g, '\n  ');
    });
    
    return `<MappingData>\n${formattedBlocks.join('\n')}\n</MappingData>`;
}

// Interactive console interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log("--- XML Common Block Filter ---");
    console.log("This tool filters common blocks from an XML file based on XPaths in a text file.\n");
    
    try {
        // Get text file path
        const textFilePath = await askQuestion('Enter the path to your text file with XPath mappings: ');
        const resolvedTextPath = path.resolve(textFilePath);
        
        if (!fs.existsSync(resolvedTextPath)) {
            console.error(`✖ Error: Text file not found at ${resolvedTextPath}`);
            rl.close();
            return;
        }
        
        // Get XML file path
        const xmlFilePath = await askQuestion('Enter the path to your XML file with common blocks: ');
        const resolvedXmlPath = path.resolve(xmlFilePath);
        
        if (!fs.existsSync(resolvedXmlPath)) {
            console.error(`✖ Error: XML file not found at ${resolvedXmlPath}`);
            rl.close();
            return;
        }
        
        // Get output file path
        const defaultOutput = 'output/filtered_mapping.xml';
        const outputPath = await askQuestion(`Enter the path for the filtered output XML file (default: ${defaultOutput}): `) || defaultOutput;
        
        console.log("\nProcessing files...");
        
        // Parse text file to get XPaths
        const xpathSet = parseTextFile(resolvedTextPath);
        console.log(`Found ${xpathSet.size} unique XPaths in text file.`);
        
        // Filter common blocks
        const { filteredBlocks, matchedCount, totalBlocks } = filterCommonBlocks(resolvedXmlPath, xpathSet);
        
        // Create output XML
        const outputXml = createOutputXml(filteredBlocks);
        
        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Write output file
        fs.writeFileSync(outputPath, outputXml, 'utf8');
        
        console.log(`\n✔ Success!`);
        console.log(`   Total common blocks in XML: ${totalBlocks}`);
        console.log(`   Matched blocks: ${matchedCount}`);
        console.log(`   Output written to: ${outputPath}`);
        
        // Show unmatched XPaths if any
        if (matchedCount < xpathSet.size) {
            console.log(`\n⚠ Warning: ${xpathSet.size - matchedCount} XPaths from the text file had no matching blocks.`);
            const showUnmatched = await askQuestion('Would you like to see the unmatched XPaths? (y/n): ');
            
            if (showUnmatched.toLowerCase() === 'y') {
                // Re-read XML to find which XPaths were matched
                const xmlContent = fs.readFileSync(resolvedXmlPath, 'utf8');
                const parser = new DOMParser();
                const doc = parser.parseFromString(xmlContent, 'application/xml');
                const commonBlocks = doc.getElementsByTagName('common');
                const matchedXpaths = new Set();
                
                for (let i = 0; i < commonBlocks.length; i++) {
                    const block = commonBlocks[i];
                    const uadXpathNodes = block.getElementsByTagName('UAD_Xpath');
                    if (uadXpathNodes.length > 0) {
                        matchedXpaths.add(uadXpathNodes[0].textContent);
                    }
                }
                
                console.log("\nUnmatched XPaths from text file:");
                xpathSet.forEach(xpath => {
                    if (!matchedXpaths.has(xpath)) {
                        console.log(`  - ${xpath}`);
                    }
                });
            }
        }
        
    } catch (error) {
        console.error(`\n✖ An error occurred: ${error.message}`);
    } finally {
        rl.close();
    }
}

// Run the application
main();