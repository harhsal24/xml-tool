const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

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

        // --- MODIFIED LOGIC to handle empty array as "force all" ---
        if (index === 1) {
            let shouldShowIndex = false;
            
            // Check for the "force for all" OR "force for specific" conditions.
            const forceForAll = options.forceIndexOneFor && options.forceIndexOneFor.length === 0;
            const forceForSpecific = options.forceIndexOneFor && options.forceIndexOneFor.includes(tagName);

            if (forceForAll || forceForSpecific) {
                // If either rule applies, we intend to show the index.
                shouldShowIndex = true;
            }

            // The exception list always overrides the forcing rules.
            if (options.exceptionsToIndexOneForcing && options.exceptionsToIndexOneForcing.includes(tagName)) {
                shouldShowIndex = false;
            }
            
            if (shouldShowIndex) {
                indexString = `[${index}]`;
            }
        } else {
            // If index is 2 or greater, always show it.
            indexString = `[${index}]`;
        }
        // --- END OF MODIFIED LOGIC ---
        
        const pathSegment = tagName + predicate + indexString;
        const newPath = currentPath + '/' + pathSegment;
        traverse(child, newPath, results, options);
    });
}


// --- --- --- Main Application Logic --- --- ---

function main() {
    // --- CONFIGURATION ---
    // You can now switch between forcing all or forcing specific tags.
    const options = {
        // SCENARIO 1: Set to [] to force index [1] for ALL tags.
        forceIndexOneFor: [], 
        
        // SCENARIO 2: Set to ['SECTION'] to only force for SECTION tags.
        // forceIndexOneFor: ['SECTION'], 

        exceptionsToIndexOneForcing: ['SUB_SECTION'],
        attributesToIncludeInPath: ['id'],
    };

    const inputFilename = process.argv[2];
    if (!inputFilename) {
        console.error("Usage: node parser.js <input_filename.xml>");
        process.exit(1);
    }
    const inputPath = path.join(__dirname, 'input', inputFilename);
    const outputDir = path.join(__dirname, 'output');
    const outputFilename = path.basename(inputFilename, path.extname(inputFilename)) + '.txt';
    const outputPath = path.join(outputDir, outputFilename);

    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        console.log(`Reading XML file from: ${inputPath}`);
        const xmlData = fs.readFileSync(inputPath, 'utf8');
        const outputContent = generateXpathList(xmlData, options);
        fs.writeFileSync(outputPath, outputContent, 'utf8');
        console.log(`✔ Successfully parsed XML and wrote output to: ${outputPath}`);
    } catch (error) {
        console.error("✖ An error occurred:", error.message);
    }
}

main();