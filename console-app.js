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

    // --- NEW LOGIC: Skip specific leaf nodes ---
    if (options.ignoreLeafNodes && options.ignoreLeafNodes.includes(node.tagName)) {
        return;
    }

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
    
    // --- DEFAULT VALUES CONFIGURATION ---
    const defaults = {
        inputFile: 'input/sample-input.xml',
        outputDir: 'output',
        attributes: 'ValuationUseType',                    // Default attributes to include
        legacyExceptions: [],              // Legacy exceptions (always show [1])
        forceIndexTags: [],                       // Force index for specific tags (empty = all)
        forceExceptions:  [ 'MESSAGE',
    'DOCUMENT_SETS',      'DOCUMENT_SET',
    'DOCUMENTS',          'DOCUMENT',
    'DEAL_SETS',          'DEAL_SET',
    'DEALS',              'DEAL',
    'SERVICES',           'SERVICE',
    'VALUATION',          'VALUATION_RESPONSE',
    'VALUATION_ANALYSES', 'VALUATION_ANALYSIS',
    'PROPERTIES'
  ] ,           // Exceptions to force rule
        ignoreLeafNodes: ['ImageFileLocationIdentifier']  // Leaf nodes to ignore
    };
    
    const inputPrompt = `Enter the path to your input XML file (default: ${defaults.inputFile}): `;
    const inputFilename = await askQuestion(inputPrompt) || defaults.inputFile;
    const inputPath = path.resolve(inputFilename);
    if (!fs.existsSync(inputPath)) {
        console.error(`✖ Error: Input file not found at ${inputPath}`);
        rl.close();
        return;
    }
    
    const defaultOutput = path.join(defaults.outputDir, path.basename(inputPath, path.extname(inputPath)) + '.txt');
    const outputPrompt = `Enter the path for your output file (default: ${defaultOutput}): `;
    const outputPath = await askQuestion(outputPrompt) || defaultOutput;
    
    const attributesPrompt = `List attributes to include in the path, separated by commas (default: ${defaults.attributes}): `;
    const attributesStr = await askQuestion(attributesPrompt) || defaults.attributes;
    
    // Legacy prompt (kept for backward compatibility)
    const legacyPrompt = `List tags that should ALWAYS have an index [1], separated by commas (default: ${defaults.legacyExceptions.join(',')}): `;
    const exceptionsStr = await askQuestion(legacyPrompt) || defaults.legacyExceptions.join(',');
    
    // --- NEW PROMPTS for enhanced control ---
    console.log('\n--- Advanced Indexing Options ---');
    const forcePrompt = `List tags to force index [1] (empty = force for ALL tags) (default: ${defaults.forceIndexTags.join(',')}): `;
    const forceIndexInput = await askQuestion(forcePrompt);
    
    // FIXED: Handle default assignment properly
    let forceIndexStr;
    if (forceIndexInput === '') {
        // User pressed enter, use default
        forceIndexStr = defaults.forceIndexTags.join(',');
    } else {
        forceIndexStr = forceIndexInput;
    }
    
    const forceExceptionsPrompt = `List tags that are EXCEPTIONS to the force rule above (default: ${defaults.forceExceptions.join(',')}): `;
    const forceExceptionsStr = await askQuestion(forceExceptionsPrompt) || defaults.forceExceptions.join(',');
    
    // --- NEW PROMPT for ignoring specific leaf nodes ---
    const ignoreLeafPrompt = `List leaf node tag names to IGNORE, separated by commas (default: ${defaults.ignoreLeafNodes.join(',')}): `;
    const ignoreLeafStr = await askQuestion(ignoreLeafPrompt) || defaults.ignoreLeafNodes.join(',');
    
    const config = {
        ignoreIndexOne: true,
        exceptionsForIgnoreIndexOne: exceptionsStr ? exceptionsStr.split(',').map(item => item.trim()).filter(item => item) : [],
        attributesToIncludeInPath: attributesStr ? attributesStr.split(',').map(item => item.trim()).filter(item => item) : [],
        // Enhanced options
        forceIndexOneFor: forceIndexStr === '' ? [] : (forceIndexStr ? forceIndexStr.split(',').map(item => item.trim()).filter(item => item) : []),
        exceptionsToIndexOneForcing: forceExceptionsStr ? forceExceptionsStr.split(',').map(item => item.trim()).filter(item => item) : [],
        disableLeafNodeIndexing: true,
        // NEW OPTION: Leaf nodes to ignore
        ignoreLeafNodes: ignoreLeafStr ? ignoreLeafStr.split(',').map(item => item.trim()).filter(item => item) : []
    };
    
    console.log("\nProcessing with the following configuration:");
    console.log('Input file:', inputPath);
    console.log('Output file:', outputPath);
    console.log('Attributes to include:', config.attributesToIncludeInPath);
    console.log('Legacy exceptions (always [1]):', config.exceptionsForIgnoreIndexOne);
    console.log('Force index tags:', config.forceIndexOneFor);
    console.log('Force exceptions:', config.exceptionsToIndexOneForcing);
    console.log('Ignored leaf nodes:', config.ignoreLeafNodes);
    
    try {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const xmlData = fs.readFileSync(inputPath, 'utf8');
        const outputContent = generateXpathList(xmlData, config);
        fs.writeFileSync(outputPath, outputContent, 'utf8');
        
        // Count lines for feedback
        const lines = outputContent.split('\n').filter(line => line.trim() !== '');
        console.log(`\n✔ Success! Generated ${lines.length} XPath entries.`);
        console.log(`Output written to: ${outputPath}`);
        
        if (config.ignoreLeafNodes.length > 0) {
            console.log(`(Ignored leaf nodes: ${config.ignoreLeafNodes.join(', ')})`);
        }
    } catch (error) {
        console.error(`\n✖ An error occurred during processing: ${error.message}`);
    } finally {
        rl.close();
    }
}

main();