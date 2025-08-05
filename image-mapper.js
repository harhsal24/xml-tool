const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('xmldom');

class ImageMappingGenerator {
    constructor() {
        this.mappings = [];
    }

    parseXML(xmlContent) {
        const parser = new DOMParser();
        return parser.parseFromString(xmlContent, 'text/xml');
    }

    generateMappings(xmlDoc) {
        // Get all PROPERTY elements
        const properties = xmlDoc.getElementsByTagName('PROPERTY');
        
        for (let i = 0; i < properties.length; i++) {
            const property = properties[i];
            const valuationType = property.getAttribute('ValuationUseType');
            
            if (!valuationType) continue;
            
            // Find all IMAGE elements within this property
            const images = property.getElementsByTagName('IMAGE');
            
            for (let j = 0; j < images.length; j++) {
                const image = images[j];
                
                // Get ImageCategoryType
                const categoryTypeElements = image.getElementsByTagName('ImageCategoryType');
                const imageFileElements = image.getElementsByTagName('ImageFileLocationIdentifier');
                const mimeTypeElements = image.getElementsByTagName('MIMETYPEIdentifier');
                
                if (categoryTypeElements.length > 0 && imageFileElements.length > 0) {
                    const categoryType = categoryTypeElements[0].textContent;
                    const fileName = imageFileElements[0].textContent;
                    
                    // Get MIMETYPEIdentifier if available
                    let aciTag = '';
                    let aciTagRedirector = '';
                    
                    if (mimeTypeElements.length > 0) {
                        const mimeTypeValue = mimeTypeElements[0].textContent;
                        // Transform IMAGE_FILE_TYPE to IMAGE_FILE
                        aciTag = mimeTypeValue.replace(/IMAGE_FILE_TYPE/g, 'IMAGE_FILE');
                        
                        // Generate ACI_TagRedirector: split by \ and use end value + IMAGE_FILE.1
                        const pathParts = aciTag.split('\\');
                        const endValue = pathParts[pathParts.length - 1];
                        // Replace the extension with IMAGE_FILE.1
                        const baseEndValue = endValue.split('.')[0];
                        aciTagRedirector = `${baseEndValue.replace(/IMAGE_FILE.*/, 'IMAGE_FILE')}.1`;
                    }
                    
                    // Create XPath mapping
                    const xpath = `//d:PROPERTY[@ValuationUseType='${valuationType}']//d:IMAGE[d:ImageCategoryType='${categoryType}']/d:ImageFileLocationIdentifier`;
                    
                    this.mappings.push({
                        valuationType: valuationType,
                        categoryType: categoryType,
                        fileName: fileName,
                        xpath: xpath,
                        aciTag: aciTag,
                        aciTagRedirector: aciTagRedirector
                    });
                }
            }
        }
    }

    generateMappingXML() {
        const xmlDoc = new DOMParser().parseFromString('<?xml version="1.0" encoding="UTF-8"?><ImageMappings></ImageMappings>', 'text/xml');
        const root = xmlDoc.documentElement;

        // Group by ValuationUseType
        const groupedMappings = {};
        this.mappings.forEach(mapping => {
            if (!groupedMappings[mapping.valuationType]) {
                groupedMappings[mapping.valuationType] = [];
            }
            groupedMappings[mapping.valuationType].push(mapping);
        });

        // Create XML structure
        Object.keys(groupedMappings).forEach(valuationType => {
            const propertyGroup = xmlDoc.createElement('PropertyGroup');
            propertyGroup.setAttribute('ValuationUseType', valuationType);
            
            groupedMappings[valuationType].forEach((mapping, index) => {
                const commonElement = xmlDoc.createElement('common');
                
                // ACI_TagRedirector
                const aciTagRedirectorElement = xmlDoc.createElement('ACI_TagRedirector');
                aciTagRedirectorElement.textContent = mapping.aciTagRedirector || 'IMAGE_FILE.1';
                
                // ACI_Tag
                const aciTagElement = xmlDoc.createElement('ACI_Tag');
                aciTagElement.textContent = mapping.aciTag || '';
                
                // ACI_TagName
                const aciTagNameElement = xmlDoc.createElement('ACI_TagName');
                aciTagNameElement.textContent = 'Global Tech Inc.';
                
                // ACI_TagIsImage
                const aciTagIsImageElement = xmlDoc.createElement('ACI_TagIsImage');
                aciTagIsImageElement.textContent = 'false';
                
                // UAD_Xpath
                const uadXpathElement = xmlDoc.createElement('UAD_Xpath');
                uadXpathElement.textContent = mapping.xpath;
                
                // Append all elements to common
                commonElement.appendChild(aciTagRedirectorElement);
                commonElement.appendChild(aciTagElement);
                commonElement.appendChild(aciTagNameElement);
                commonElement.appendChild(aciTagIsImageElement);
                commonElement.appendChild(uadXpathElement);
                
                propertyGroup.appendChild(commonElement);
            });
            
            root.appendChild(propertyGroup);
        });

        return new XMLSerializer().serializeToString(xmlDoc);
    }

    displayConsoleOutput() {
        console.log('\n=== IMAGE MAPPING RESULTS ===\n');
        
        // Group by ValuationUseType for display
        const groupedMappings = {};
        this.mappings.forEach(mapping => {
            if (!groupedMappings[mapping.valuationType]) {
                groupedMappings[mapping.valuationType] = [];
            }
            groupedMappings[mapping.valuationType].push(mapping);
        });

        Object.keys(groupedMappings).forEach(valuationType => {
            console.log(`Property Type: ${valuationType}`);
            console.log('─'.repeat(60));
            
            groupedMappings[valuationType].forEach((mapping, index) => {
                console.log(`  ${index + 1}. Category: ${mapping.categoryType}`);
                console.log(`     File: ${mapping.fileName}`);
                console.log(`     ACI_Tag: ${mapping.aciTag}`);
                console.log(`     ACI_TagRedirector: ${mapping.aciTagRedirector}`);
                console.log(`     XPath: ${mapping.xpath}`);
                console.log('');
            });
        });
    }
}

// Utility functions
function getInputFilePath() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage: node image-mapper.js <input-xml-file-path> [output-file-path]');
        console.log('Example: node image-mapper.js input.xml output-mappings.xml');
        process.exit(1);
    }
    
    return args[0];
}

function getOutputFilePath(inputFilePath) {
    const args = process.argv.slice(2);
    
    if (args.length > 1) {
        return args[1];
    }
    
    // Generate output filename based on input filename
    const inputDir = path.dirname(inputFilePath);
    const inputName = path.basename(inputFilePath, path.extname(inputFilePath));
    return path.join(inputDir, `${inputName}-image-mappings.xml`);
}

function validateInputFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Input file does not exist: ${filePath}`);
    }
    
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`);
    }
    
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.xml') {
        console.warn(`Warning: File extension is '${ext}', expected '.xml'`);
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
        // Ensure the output directory exists
        ensureOutputDirectory(filePath);
        
        // Write the file
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Image mapping XML saved to: ${filePath}`);
        
        // Verify file was created successfully
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            console.log(`📁 File size: ${stats.size} bytes`);
            console.log(`📅 Created: ${stats.birthtime.toLocaleString()}`);
        }
        
    } catch (error) {
        throw new Error(`Failed to save output file: ${error.message}`);
    }
}

// Main execution
function main() {
    console.log('Image Mapping XML Generator');
    console.log('===========================\n');

    try {
        // Get input file path from command line arguments
        const inputFilePath = getInputFilePath();
        const outputFilePath = getOutputFilePath(inputFilePath);
        
        console.log(`Input file: ${inputFilePath}`);
        console.log(`Output file: ${outputFilePath}\n`);
        
        // Validate input file
        validateInputFile(inputFilePath);
        
        // Read XML content from file
        console.log('Reading XML file...');
        const xmlContent = fs.readFileSync(inputFilePath, 'utf8');
        
        const generator = new ImageMappingGenerator();
        
        // Parse XML
        console.log('Parsing XML...');
        const xmlDoc = generator.parseXML(xmlContent);
        
        // Generate mappings
        console.log('Generating mappings...');
        generator.generateMappings(xmlDoc);
        
        if (generator.mappings.length === 0) {
            console.log('⚠️  No image mappings found in the XML file.');
            console.log('Make sure the file contains PROPERTY elements with IMAGE children.');
            return;
        }
        
        // Display results in console
        generator.displayConsoleOutput();
        
        // Generate mapping XML
        console.log('Generating mapping XML...');
        const mappingXML = generator.generateMappingXML();
        
        // Save to output file (create if doesn't exist)
        console.log('Saving output file...');
        saveOutputFile(outputFilePath, mappingXML);
        
        console.log(`📊 Total mappings generated: ${generator.mappings.length}`);
        console.log('✅ Process completed successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the application
main();