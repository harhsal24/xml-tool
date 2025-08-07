const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('xmldom');

class ImageMappingGenerator {
    constructor() {
        this.mappings = [];
    }

    parseMappingFile(content) {
        const lines = content.split(/\r?\n/);
        let counter = 1;
        let processedLines = 0;
        let imageFileLocationLines = 0;
        
        console.log(`Total lines in file: ${lines.length}`);
        
        lines.forEach((line, index) => {
            line = line.trim();
            if (!line) return;
            
            processedLines++;
            
            // Split by ' : ' to separate value from xpath
            const separatorIndex = line.indexOf(' : ');
            if (separatorIndex === -1) {
                console.log(`Line ${index + 1}: No separator found - "${line.substring(0, 50)}..."`);
                return;
            }
            
            const value = line.substring(0, separatorIndex).trim();
            const fullXpath = line.substring(separatorIndex + 3).trim();
            
            // Only process ImageFileLocationIdentifier entries
            if (!fullXpath.includes('ImageFileLocationIdentifier')) {
                return;
            }
            
            imageFileLocationLines++;
            console.log(`Processing ImageFileLocationIdentifier line ${imageFileLocationLines}: ${value}`);
            
            // Extract information from the XPath
            const xpathInfo = this.extractXPathInfo(fullXpath);
            
            if (xpathInfo) {
                console.log(`  ✓ Extracted: ${xpathInfo.valuationType}[${xpathInfo.propertyPosition}]/IMAGE[${xpathInfo.imagePosition}]`);
                
                // Try to find corresponding MIMETYPEIdentifier in the same image
                const mimeTypeValue = this.findCorrespondingMimeType(lines, xpathInfo);
                
                // Generate ACI_Tag and ACI_TagRedirector
                let aciTag = '';
                let aciTagRedirector = '';
                
                if (mimeTypeValue) {
                    aciTag = mimeTypeValue;
                    console.log(`  ✓ Found MIME type: ${mimeTypeValue}`);
                    
                    // Generate ACI_TagRedirector: extract the file type number and create IMAGE_FILE.{number}
                    const match = mimeTypeValue.match(/IMAGE_FILE_TYPE\.(\d+)$/);
                    if (match) {
                        aciTagRedirector = `IMAGE_FILE.${match[1]}`;
                    } else {
                        aciTagRedirector = `IMAGE_FILE.${counter}`;
                    }
                } else {
                    // Fallback if no MIMETYPEIdentifier found
                    aciTagRedirector = `IMAGE_FILE.${counter}`;
                    aciTag = '';
                    console.log(`  ! No MIME type found, using fallback`);
                }
                
                // Convert full XPath to shortened format with d: prefix
                const shortXpath = this.convertToShortXPath(fullXpath);
                
                this.mappings.push({
                    fileName: value,
                    fullXpath: fullXpath,
                    shortXpath: shortXpath,
                    aciTag: aciTag,
                    aciTagRedirector: aciTagRedirector,
                    valuationType: xpathInfo.valuationType,
                    propertyPosition: xpathInfo.propertyPosition,
                    imagePosition: xpathInfo.imagePosition
                });
                
                counter++;
            } else {
                console.log(`  ✗ Could not extract XPath info`);
            }
        });
        
        console.log(`\nProcessed ${processedLines} non-empty lines`);
        console.log(`Found ${imageFileLocationLines} ImageFileLocationIdentifier lines`);
        console.log(`Successfully created ${this.mappings.length} mappings`);
    }

    extractXPathInfo(xpath) {
        console.log(`  Trying to extract from: ${xpath.substring(0, 150)}...`);
        
        // Test different regex patterns to see which one works
        let valuationMatch;
        
        // Pattern 1: Simple pattern
        valuationMatch = xpath.match(/PROPERTY$$@ValuationUseType="([^"]+)"$$/);
        if (valuationMatch) {
            console.log(`  ✓ Found ValuationUseType with simple pattern: ${valuationMatch[1]}`);
        } else {
            console.log(`  ✗ Simple pattern failed`);
        }
        
        // Pattern 2: With optional position
        valuationMatch = xpath.match(/PROPERTY$$@ValuationUseType="([^"]+)"$$(?:$$(\d+)$$)?/);
        if (valuationMatch) {
            console.log(`  ✓ Found ValuationUseType with position pattern: ${valuationMatch[1]}, position: ${valuationMatch[2] || '1'}`);
            
            const valuationType = valuationMatch[1];
            const propertyPosition = valuationMatch[2] ? parseInt(valuationMatch[2]) : 1;
            
            // Extract image position
            const imageMatch = xpath.match(/IMAGE$$(\d+)$$/);
            const imagePosition = imageMatch ? parseInt(imageMatch[1]) : 1;
            
            console.log(`  Final values: type=${valuationType}, propPos=${propertyPosition}, imgPos=${imagePosition}`);
            
            return {
                valuationType,
                propertyPosition,
                imagePosition
            };
        } else {
            console.log(`  ✗ Position pattern failed`);
            
            // Let's try a more flexible pattern
            const flexibleMatch = xpath.match(/ValuationUseType="([^"]+)"/);
            if (flexibleMatch) {
                console.log(`  ✓ Found with flexible pattern: ${flexibleMatch[1]}`);
                
                // Try to extract position
                const posMatch = xpath.match(/PROPERTY$$@ValuationUseType="[^"]+"$$$$(\d+)$$/);
                const propertyPosition = posMatch ? parseInt(posMatch[1]) : 1;
                
                const imageMatch = xpath.match(/IMAGE$$(\d+)$$/);
                const imagePosition = imageMatch ? parseInt(imageMatch[1]) : 1;
                
                return {
                    valuationType: flexibleMatch[1],
                    propertyPosition,
                    imagePosition
                };
            }
        }
        
        return null;
    }

    findCorrespondingMimeType(lines, xpathInfo) {
        // Look for MIMETYPEIdentifier in the same IMAGE element
        let targetPattern1, targetPattern2;
        
        if (xpathInfo.propertyPosition === 1) {
            targetPattern1 = `PROPERTY[@ValuationUseType="${xpathInfo.valuationType}"]`;
            targetPattern2 = `PROPERTY[@ValuationUseType="${xpathInfo.valuationType}"][1]`;
        } else {
            targetPattern1 = `PROPERTY[@ValuationUseType="${xpathInfo.valuationType}"][${xpathInfo.propertyPosition}]`;
            targetPattern2 = targetPattern1;
        }
        
        const imagePattern = `IMAGE[${xpathInfo.imagePosition}]/MIMETYPEIdentifier`;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if ((trimmedLine.includes(targetPattern1) || trimmedLine.includes(targetPattern2)) && 
                trimmedLine.includes(imagePattern)) {
                const colonIndex = trimmedLine.indexOf(' : ');
                if (colonIndex !== -1) {
                    return trimmedLine.substring(0, colonIndex).trim();
                }
            }
        }
        return null;
    }

    convertToShortXPath(fullXpath) {
        const valuationMatch = fullXpath.match(/PROPERTY$$@ValuationUseType="([^"]+)"$$(?:$$(\d+)$$)?.*?IMAGE$$(\d+)$$/);
        
        if (valuationMatch) {
            const valuationType = valuationMatch[1];
            const propertyPosition = valuationMatch[2] ? parseInt(valuationMatch[2]) : 1;
            const imagePosition = parseInt(valuationMatch[3]);
            
            if (propertyPosition === 1) {
                return `//d:PROPERTY[@ValuationUseType='${valuationType}']/d:INSPECTIONS/d:INSPECTION/d:IMAGES/d:IMAGE[${imagePosition}]/d:ImageFileLocationIdentifier`;
            } else {
                return `//d:PROPERTY[@ValuationUseType='${valuationType}'][${propertyPosition}]/d:INSPECTIONS/d:INSPECTION/d:IMAGES/d:IMAGE[${imagePosition}]/d:ImageFileLocationIdentifier`;
            }
        }
        
        return fullXpath;
    }

    generateMappingXML() {
        const xmlDoc = new DOMParser().parseFromString('<?xml version="1.0" encoding="UTF-8"?><ImageMappings></ImageMappings>', 'text/xml');
        const root = xmlDoc.documentElement;

        this.mappings.forEach((mapping, index) => {
            const commonElement = xmlDoc.createElement('common');
            
            const aciTagRedirectorElement = xmlDoc.createElement('ACI_TagRedirector');
            aciTagRedirectorElement.textContent = mapping.aciTagRedirector;
            
            const aciTagElement = xmlDoc.createElement('ACI_Tag');
            aciTagElement.textContent = mapping.aciTag;
            
            const aciTagNameElement = xmlDoc.createElement('ACI_TagName');
            aciTagNameElement.textContent = 'Global Tech Inc.';
            
            const aciTagIsImageElement = xmlDoc.createElement('ACI_TagIsImage');
            aciTagIsImageElement.textContent = 'true';
            
            const aciImageSourceElement = xmlDoc.createElement('ACI_ImageSource');
            aciImageSourceElement.textContent = 'd:ImageFileLocationIdentifier';
            
            const uadXpathElement = xmlDoc.createElement('UAD_Xpath');
            uadXpathElement.textContent = mapping.shortXpath;
            
            commonElement.appendChild(aciTagRedirectorElement);
            commonElement.appendChild(aciTagElement);
            commonElement.appendChild(aciTagNameElement);
            commonElement.appendChild(aciTagIsImageElement);
            commonElement.appendChild(aciImageSourceElement);
            commonElement.appendChild(uadXpathElement);
            
            root.appendChild(commonElement);
        });

        const serializedXML = new XMLSerializer().serializeToString(xmlDoc);
        return this.formatXML(serializedXML);
    }

    formatXML(xml) {
        let formatted = '';
        let indent = '';
        const tab = '    ';
        
        xml.split(/>\s*</).forEach((node, index) => {
            if (index > 0) {
                node = '<' + node;
            }
            if (index < xml.split(/>\s*</).length - 1) {
                node = node + '>';
            }
            
            const padding = node.match(/.+<\/\w[^>]*>$/);
            const indent_level = indent;
            
            if (node.match(/^<\/\w/) && indent_level) {
                indent = indent_level.substring(tab.length);
            }
            
            formatted += indent + node + '\n';
            
            if (node.match(/^<\w[^>]*[^\/]>.*$/) && !padding) {
                indent += tab;
            }
        });
        
        return formatted.trim();
    }

    displayConsoleOutput() {
        console.log('\n=== IMAGE FILE LOCATION IDENTIFIER MAPPING RESULTS ===\n');
        
        this.mappings.forEach((mapping, index) => {
            console.log(`${index + 1}. Property Type: ${mapping.valuationType} [${mapping.propertyPosition}]`);
            console.log(`   Image Position: ${mapping.imagePosition}`);
            console.log(`   File: ${mapping.fileName}`);
            console.log(`   ACI_TagRedirector: ${mapping.aciTagRedirector}`);
            console.log(`   ACI_Tag: ${mapping.aciTag}`);
            console.log(`   Short XPath: ${mapping.shortXpath}`);
            console.log('   ─'.repeat(80));
        });
        
        console.log(`\nTotal mappings: ${this.mappings.length}`);
    }
}

// Rest of the utility functions remain the same...
function getInputFilePath() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node image-mapper.js <input-mapping-file-path> [output-file-path]');
        console.log('Example: node image-mapper.js mappings.txt');
        console.log('Example: node image-mapper.js mappings.txt custom-output.xml');
        console.log('\nDefault output: output/<filename>-image-mapperv2.xml');
        process.exit(1);
    }
    
    return args[0];
}

function getOutputFilePath(inputFilePath) {
    const args = process.argv.slice(2);
    
    if (args.length > 1) {
        return args[1];
    }
    
    const inputName = path.basename(inputFilePath, path.extname(inputFilePath));
    const outputDir = 'output';
    return path.join(outputDir, `${inputName}-image-mapperv2.xml`);
}

function validateInputFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Input file does not exist: ${filePath}`);
    }
    
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
    }
}

function ensureOutputDirectory(filePath) {
    const directory = path.dirname(filePath);
    
    if (!fs.existsSync(directory)) {
        console.log(`Creating output directory: ${directory}`);
        fs.mkdirSync(directory, { recursive: true });
    }
}

function saveOutputFile(filePath, content) {
    try {
        ensureOutputDirectory(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Image location mapping XML saved to: ${filePath}`);
        
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            console.log(`📁 File size: ${stats.size} bytes`);
            console.log(`📅 Created: ${stats.birthtime.toLocaleString()}`);
        }
        
    } catch (error) {
        throw new Error(`Failed to save output file: ${error.message}`);
    }
}

function main() {
    console.log('Image File Location Identifier Mapping Generator v2');
    console.log('================================================\n');

    try {
        const inputFilePath = getInputFilePath();
        const outputFilePath = getOutputFilePath(inputFilePath);
        
        console.log(`Input file: ${inputFilePath}`);
        console.log(`Output file: ${outputFilePath}\n`);
        
        validateInputFile(inputFilePath);
        
        console.log('Reading mapping file...');
        const fileContent = fs.readFileSync(inputFilePath, 'utf8');
        
        const generator = new ImageMappingGenerator();
        
        console.log('Parsing mappings...');
        generator.parseMappingFile(fileContent);
        
        if (generator.mappings.length === 0) {
            console.log('⚠️  No ImageFileLocationIdentifier mappings found in the file.');
            console.log('Make sure the file contains lines with ImageFileLocationIdentifier in the XPath.');
            return;
        }
        
        generator.displayConsoleOutput();
        
        console.log('Generating mapping XML...');
        const mappingXML = generator.generateMappingXML();
        
        console.log('Saving output file...');
        saveOutputFile(outputFilePath, mappingXML);
        
        console.log(`📊 Total mappings generated: ${generator.mappings.length}`);
        console.log('✅ Process completed successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();