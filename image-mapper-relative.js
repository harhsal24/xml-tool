// image-mapper-relative.js
// Usage:
//   node image-mapper-relative.js input.xml output-mappings.xml

const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

/** safely format an XPath literal (handles single/double quotes) */
function formatXPathLiteral(value) {
  if (value.indexOf("'") === -1) return `'${value}'`;
  if (value.indexOf('"') === -1) return `"${value}"`;
  // contains both -> build concat(...)
  const parts = value.split("'");
  const concatParts = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) concatParts.push(`'${parts[i]}'`);
    if (i < parts.length - 1) concatParts.push(`"'"`);
  }
  return `concat(${concatParts.join(',')})`;
}

/** get first descendant child element with given localName (no prefix) */
function getChildElementByLocalName(parent, localName) {
  if (!parent || !parent.getElementsByTagName) return null;
  // iterate all descendant elements and return the first one whose localName matches
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const ln = el.localName || el.tagName || '';
    if (ln === localName) return el;
  }
  return null;
}

/** get all descendant elements (in document order) with localName under a given node */
function getDescendantElementsByLocalName(parent, localName) {
  const out = [];
  if (!parent || !parent.getElementsByTagName) return out;
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const ln = el.localName || el.tagName || '';
    if (ln === localName) out.push(el);
  }
  return out;
}

/** Extract trimmed textContent of a child element (by localName) or '' */
function getChildText(parent, childLocalName) {
  const c = getChildElementByLocalName(parent, childLocalName);
  if (!c) return '';
  return (c.textContent || '').trim();
}

/** Build property anchor XPath using ValuationUseType attribute (escaped) */
function buildPropertyAnchorXPath(propertyNode) {
  const valAttr = propertyNode.getAttribute && (propertyNode.getAttribute('ValuationUseType') ?? propertyNode.getAttribute('valuationusetype') ?? null);
  if (valAttr && valAttr.trim().length > 0) {
    return `//PROPERTY[@ValuationUseType=${formatXPathLiteral(valAttr.trim())}]`;
  }
  // fallback: anchor by position among PROPERTIES if ValuationUseType missing
  // compute index among sibling PROPERTIES at document level
  const doc = propertyNode.ownerDocument || propertyNode;
  const props = [];
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const ln = el.localName || el.tagName || '';
    if (ln === 'PROPERTY') props.push(el);
  }
  const idx = props.indexOf(propertyNode);
  if (idx === -1) return '/PROPERTY';
  return `(/PROPERTY)[${idx + 1}]`;
}

/** Main: generate mappings using relative XPath for IMAGE filtered by ImageCategoryType */
function generateRelativeImageMappings(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const err = doc.getElementsByTagName('parsererror');
  if (err && err.length) throw new Error('XML parse error: ' + new XMLSerializer().serializeToString(err[0]));

  // find all PROPERTY elements (by localName)
  const all = doc.getElementsByTagName('*');
  const properties = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const ln = el.localName || el.tagName || '';
    if (ln === 'PROPERTY') properties.push(el);
  }

  const mappings = [];

  properties.forEach(property => {
    const valuationType = (property.getAttribute && (property.getAttribute('ValuationUseType') ?? property.getAttribute('valuationusetype'))) || '';
    const propertyAnchor = buildPropertyAnchorXPath(property);

    // get all IMAGE descendant elements under this property (document order)
    const images = getDescendantElementsByLocalName(property, 'IMAGE');

    // group images by ImageCategoryType value (preserve order)
    const groups = {}; // { categoryValue: [imageNode, ...] }
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const categoryValue = getChildText(img, 'ImageCategoryType') || ''; // empty string if missing
      if (!groups.hasOwnProperty(categoryValue)) groups[categoryValue] = [];
      groups[categoryValue].push(img);
    }

    // for each image node create mapping using index among its group's order
    Object.keys(groups).forEach(categoryValue => {
      const group = groups[categoryValue];
      for (let i = 0; i < group.length; i++) {
        const imgNode = group[i];
        const indexInGroup = i + 1; // 1-based index among images with same ImageCategoryType in this property
        const fileName = getChildText(imgNode, 'ImageFileLocationIdentifier');

        // Build relative xpath (relative to PROPERTY anchor)
        // We use .//IMAGE[ImageCategoryType='...'][n]/ImageFileLocationIdentifier
        // NOTE: we use local names without prefixes for portability
        const catLiteral = formatXPathLiteral(categoryValue);
        const relativeXpath = `.//IMAGE[ImageCategoryType=${catLiteral}][${indexInGroup}]/ImageFileLocationIdentifier`;

        mappings.push({
          valuationType: valuationType,
          propertyAnchor: propertyAnchor,
          categoryType: categoryValue,
          index: indexInGroup,
          fileName: fileName,
          relativeXpath: relativeXpath
        });
      }
    });
  });

  return mappings;
}

/** Build mapping XML similar to your previous format, but UAD_Xpath uses the relative XPath */
function buildMappingXmlFromMappings(mappings) {
  const xmlDoc = new DOMParser().parseFromString('<?xml version="1.0" encoding="UTF-8"?><ImageMappings></ImageMappings>', 'application/xml');
  const root = xmlDoc.documentElement;

  // group by valuationType
  const groups = {};
  mappings.forEach(m => {
    const key = m.valuationType || '__NO_VALUATION__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  Object.keys(groups).forEach(valuationType => {
    const propertyGroup = xmlDoc.createElement('PropertyGroup');
    if (valuationType !== '__NO_VALUATION__') propertyGroup.setAttribute('ValuationUseType', valuationType);

    groups[valuationType].forEach(m => {
      const common = xmlDoc.createElement('common');

      const aciTagRedirector = xmlDoc.createElement('ACI_TagRedirector');
      aciTagRedirector.textContent = 'IMAGE_FILE.1'; // default, adjust as needed

      const aciTag = xmlDoc.createElement('ACI_Tag');
      aciTag.textContent = '';

      const aciTagName = xmlDoc.createElement('ACI_TagName');
      aciTagName.textContent = 'Global Tech Inc.';

      const aciTagIsImage = xmlDoc.createElement('ACI_TagIsImage');
      aciTagIsImage.textContent = 'false';

      const uadXpath = xmlDoc.createElement('UAD_Xpath');
      // combine propertyAnchor and relative as comment? Keep relative only as requested
      uadXpath.textContent = m.relativeXpath;

      const fileEl = xmlDoc.createElement('FileName');
      fileEl.textContent = m.fileName || '';

      const catEl = xmlDoc.createElement('ImageCategoryType');
      catEl.textContent = m.categoryType || '';

      const idxEl = xmlDoc.createElement('ImageIndex');
      idxEl.textContent = String(m.index);

      // append children
      common.appendChild(aciTagRedirector);
      common.appendChild(aciTag);
      common.appendChild(aciTagName);
      common.appendChild(aciTagIsImage);
      common.appendChild(uadXpath);
      common.appendChild(fileEl);
      common.appendChild(catEl);
      common.appendChild(idxEl);

      propertyGroup.appendChild(common);
    });

    root.appendChild(propertyGroup);
  });

  return new XMLSerializer().serializeToString(xmlDoc);
}

// CLI runner
function main() {
  try {
    const argv = process.argv.slice(2);
    if (argv.length < 1) {
      console.error('Usage: node image-mapper-relative.js <input.xml> [output-mappings.xml]');
      process.exit(1);
    }
    const inputPath = path.resolve(argv[0]);
    const outputPath = argv[1] ? path.resolve(argv[1]) : path.join(path.dirname(inputPath), path.basename(inputPath, path.extname(inputPath)) + '-image-mappings-relative.xml');

    if (!fs.existsSync(inputPath)) {
      console.error('Input file not found:', inputPath);
      process.exit(1);
    }

    const xml = fs.readFileSync(inputPath, 'utf8');
    const mappings = generateRelativeImageMappings(xml);

    if (mappings.length === 0) {
      console.log('No image mappings found.');
      process.exit(0);
    }

    // show a quick console summary
    console.log('Found mappings:', mappings.length);
    // group by valuationType for console display
    const grouped = {};
    mappings.forEach(m => {
      const k = m.valuationType || '<no valuation>';
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(m);
    });

    Object.keys(grouped).forEach(k => {
      console.log(`\nProperty Type: ${k}`);
      grouped[k].forEach((m, i) => {
        console.log(`  ${i+1}. Category='${m.categoryType}' Index=${m.index}`);
        console.log(`     File: ${m.fileName}`);
        console.log(`     Property anchor: ${m.propertyAnchor}`);
        console.log(`     Relative XPath: ${m.relativeXpath}`);
      });
    });

    // write mapping xml
    const mappingXml = buildMappingXmlFromMappings(mappings);
    fs.writeFileSync(outputPath, mappingXml, 'utf8');
    console.log(`\nSaved mapping XML to ${outputPath}`);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { generateRelativeImageMappings };
