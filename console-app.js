const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

// --- Core Parsing Logic (with enhanced indexing control) ---

function generateXpathList(xmlString, options) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');
    const errorNode = doc.getElementsByTagName('parsererror');
    if (errorNode.length > 0) {
        throw new Error('XML Parsing Error: ' + new XMLSerializer().serializeToString(errorNode[0]));
    }
    const results = [];
    if (doc.documentElement) {
        const rootPath = '/' + doc.documentElement.tagName;
        traverse(doc.documentElement, rootPath, results, options);
    }
    return results.join('\n');
}

function traverse(node, currentPath, results, options) {
    if (node.nodeType !== 1) return;

    const childElements = Array.from(node.childNodes).filter(n => n.nodeType === 1);

    if (childElements.length === 0 && node.textContent.trim()) {
        const leafValue = node.textContent.trim();
        results.push(`${leafValue} : ${currentPath}`);
        return;
    }

    const siblingCounters = {};
    childElements.forEach(child => {
        let tagName = child.tagName;
        let predicate = '';
        if (options.attributesToIncludeInPath) {
            options.attributesToIncludeInPath.forEach(attrName => {
                if (child.hasAttribute(attrName)) {
                    predicate += `[@${attrName}="${child.getAttribute(attrName)}"]`;
                }
            });
        }
        const nodeKey = tagName + predicate;
        siblingCounters[nodeKey] = (siblingCounters[nodeKey] || 0) + 1;
        const index = siblingCounters[nodeKey];
        let indexString = '';

        // --- ENHANCED INDEXING LOGIC ---
        if (index === 1) {
            let shouldShowIndex = false;
            
            // First check the legacy "exceptionsForIgnoreIndexOne" for backward compatibility
            if (options.exceptionsForIgnoreIndexOne && options.exceptionsForIgnoreIndexOne.includes(tagName)) {
                shouldShowIndex = true;
            }
            
            // Then check the new "forceIndexOneFor" rules
            if (options.forceIndexOneFor) {
                const forceForAll = options.forceIndexOneFor.length === 0;
                const forceForSpecific = options.forceIndexOneFor.includes(tagName);
                
                if (forceForAll || forceForSpecific) {
                    shouldShowIndex = true;
                }
            }
            
            // Finally, the new exceptions list overrides everything
            if (options.exceptionsToIndexOneForcing && options.exceptionsToIndexOneForcing.includes(tagName)) {
                shouldShowIndex = false;
            }
            
            if (shouldShowIndex) {
                indexString = `[${index}]`;
            }
        } else {
            // If index is 2 or greater, always show it
            indexString = `[${index}]`;
        }
        // --- END OF ENHANCED LOGIC ---
        
        const pathSegment = tagName + predicate + indexString;
        const newPath = currentPath + '/' + pathSegment;
        traverse(child, newPath, results, options);
    });
}

// --- Interactive Console Logic (with new prompts) ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log("--- Welcome to the Interactive XML Parser ---");
    
    const inputFilename = await askQuestion('Enter the path to your input XML file (e.g., input/stores.xml): ');
    const inputPath = path.resolve(inputFilename);
    if (!fs.existsSync(inputPath)) {
        console.error(`✖ Error: Input file not found at ${inputPath}`);
        rl.close();
        return;
    }
    
    const defaultOutput = path.join('output', path.basename(inputPath, path.extname(inputPath)) + '.txt');
    const outputPath = await askQuestion(`Enter the path for your output file (press Enter for default: ${defaultOutput}): `) || defaultOutput;
    
    const attributesStr = await askQuestion('List attributes to include in the path, separated by commas (e.g., ValuationType,name): ');
    
    // Legacy prompt (kept for backward compatibility)
    const exceptionsStr = await askQuestion('List tags that should ALWAYS have an index [1], separated by commas (e.g., toys,books): ');
    
    // --- NEW PROMPTS for enhanced control ---
    console.log('\n--- Advanced Indexing Options ---');
    const forceIndexStr = await askQuestion('List tags to force index [1] (empty = force for ALL tags), separated by commas: ');
    const forceExceptionsStr = await askQuestion('List tags that are EXCEPTIONS to the force rule above (never show [1]), separated by commas: ');
    
    const config = {
        ignoreIndexOne: true,
        exceptionsForIgnoreIndexOne: exceptionsStr ? exceptionsStr.split(',').map(item => item.trim()) : [],
        attributesToIncludeInPath: attributesStr ? attributesStr.split(',').map(item => item.trim()) : [],
        // New options
        forceIndexOneFor: forceIndexStr === '' ? [] : (forceIndexStr ? forceIndexStr.split(',').map(item => item.trim()) : null),
        exceptionsToIndexOneForcing: forceExceptionsStr ? forceExceptionsStr.split(',').map(item => item.trim()) : [],
        disableLeafNodeIndexing: true,
    };
    
    console.log("\nProcessing with the following configuration:");
    console.log(config);
    
    try {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const xmlData = fs.readFileSync(inputPath, 'utf8');
        const outputContent = generateXpathList(xmlData, config);
        fs.writeFileSync(outputPath, outputContent, 'utf8');
                console.log(`\n✔ Success! Output written to: ${outputPath}`);
    } catch (error) {
        console.error(`\n✖ An error occurred during processing: ${error.message}`);
    } finally {
        rl.close();
    }
}

main();