const fs = require('fs');
const path = require('path'); // Import the 'path' module
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

/**
 * Main function to generate the XPath-like list from an XML string.
 * (This function is unchanged)
 * @param {string} xmlString The raw XML content as a string.
 * @param {object} options Configuration options for parsing.
 * @returns {string} The formatted output string with each leaf node and its path on a new line.
 */
function generateXpathList(xmlString, options) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    const errorNode = doc.getElementsByTagName('parsererror');
    if (errorNode.length > 0) {
        throw new Error('XML Parsing Error: ' + new XMLSerializer().serializeToString(errorNode[0]));
    }

    const results = [];
    traverse(doc.documentElement, '', results, options);
    return results.join('\n');
}

/**
 * Recursively traverses the XML DOM tree to find leaf nodes and construct their paths.
 * (This function is unchanged)
 * @param {Element} node The current XML node to process.
 * @param {string} currentPath The path constructed so far.
 * @param {string[]} results An array to store the final output lines.
 * @param {object} options The configuration options.
 */
function traverse(node, currentPath, results, options) {
    if (node.nodeType !== 1) return;

    const childElements = Array.from(node.childNodes).filter(n => n.nodeType === 1);

    if (childElements.length === 0 && node.textContent.trim()) {
        const leafValue = node.textContent.trim();
        let leafPathSegment = node.tagName;
        if (!options.disableLeafNodeIndexing) {
           // Indexing logic for leaf nodes could be added here if needed
        }
        const fullPath = currentPath + '/' + leafPathSegment;
        results.push(`${leafValue} : ${fullPath}`);
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
        let shouldShowIndex = true;
        if (options.ignoreIndexOne && index === 1) {
            if (options.exceptionsForIgnoreIndexOne && options.exceptionsForIgnoreIndexOne.includes(tagName)) {
                shouldShowIndex = true;
            } else {
                shouldShowIndex = false;
            }
        }
        
        if (shouldShowIndex) {
            indexString = `[${index}]`;
        }
        
        const pathSegment = tagName + predicate + indexString;
        const newPath = (currentPath ? currentPath + '/' : '') + pathSegment;
        traverse(child, newPath, results, options);
    });
}


// --- --- --- Main Application Logic --- --- ---

function main() {
    // --- Configuration ---
    const options = {
        ignoreIndexOne: true,
        exceptionsForIgnoreIndexOne: ['toys'],
        attributesToIncludeInPath: ['ValuationType'],
        disableLeafNodeIndexing: true,
    };

    // --- File Handling ---
    // Get the filename from the command line arguments
    const inputFilename = process.argv[2];
    if (!inputFilename) {
        console.error("Usage: node parser.js <input_filename.xml>");
        process.exit(1); // Exit with an error code
    }

    const inputPath = path.join(__dirname, 'input', inputFilename);
    const outputDir = path.join(__dirname, 'output');
    // Create an output filename based on the input filename (e.g., stores.xml -> stores.txt)
    const outputFilename = path.basename(inputFilename, path.extname(inputFilename)) + '.txt';
    const outputPath = path.join(outputDir, outputFilename);

    try {
        // Ensure the output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
            console.log(`Created output directory at: ${outputDir}`);
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

// Run the main function
main();