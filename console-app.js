const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

// --- Core Parsing Logic (with corrections) ---

/**
 * Main function to generate the XPath-like list from an XML string.
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
    if (doc.documentElement) {
        // CHANGED: Create the initial path for the root element here.
        // The root element never has an index.
        const rootPath = '/' + doc.documentElement.tagName;
        // CHANGED: Start the traversal from the root, passing its own full path.
        traverse(doc.documentElement, rootPath, results, options);
    }
    return results.join('\n');
}

/**
 * Recursively traverses the XML DOM tree.
 * The `currentPath` parameter now represents the full, absolute path to the `node`.
 */
function traverse(node, currentPath, results, options) {
    if (node.nodeType !== 1) return;

    const childElements = Array.from(node.childNodes).filter(n => n.nodeType === 1);

    // BASE CASE: This is a leaf node if it has no element children.
    if (childElements.length === 0 && node.textContent.trim()) {
        const leafValue = node.textContent.trim();
        // CHANGED: The 'currentPath' is now the complete, correct path to the leaf.
        results.push(`${leafValue} : ${currentPath}`);
        return;
    }

    // RECURSIVE STEP: This node has children. Iterate through them.
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
        // CHANGED: The new path is built by appending to the parent's full path.
        const newPath = currentPath + '/' + pathSegment;

        // Recurse deeper into the tree with the child's full path
        traverse(child, newPath, results, options);
    });
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
    const exceptionsStr = await askQuestion('List tags that should ALWAYS have an index [1], separated by commas (e.g., toys,books): ');
    const config = {
        ignoreIndexOne: true,
        exceptionsForIgnoreIndexOne: exceptionsStr ? exceptionsStr.split(',').map(item => item.trim()) : [],
        attributesToIncludeInPath: attributesStr ? attributesStr.split(',').map(item => item.trim()) : [],
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