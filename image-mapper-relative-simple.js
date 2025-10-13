#!/usr/bin/env node
// image-mapper-relative-simple.js
// Usage:
//   node image-mapper-relative-simple.js input.xml output.txt
//
// Output: a text file where each non-empty line is: "<value> : <relative-xpath>"
//
// Notes:
// - CLI no longer supports mapping.json or elements list.
// - To use namespace prefixes or custom elements, call generateRelativeImageMappings(...) programmatically:
//     generateRelativeImageMappings(xmlString, { namespacePrefix: 'd', elementsToIncludeInPath: ['IMAGES','SET'] })

const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

/** format an XPath literal safely (handles single/double quotes) */
function formatXPathLiteral(value) {
  if (value.indexOf("'") === -1) return `'${value}'`;
  if (value.indexOf('"') === -1) return `"${value}"`;
  const parts = value.split("'");
  const concatParts = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) concatParts.push(`'${parts[i]}'`);
    if (i < parts.length - 1) concatParts.push(`"'"`);
  }
  return `concat(${concatParts.join(',')})`;
}

/** strip namespace prefix if present, e.g. d:IMAGES -> IMAGES */
function stripPrefix(tagName) {
  if (!tagName || typeof tagName !== 'string') return tagName;
  const idx = tagName.indexOf(':');
  return idx === -1 ? tagName : tagName.substring(idx + 1);
}

/** return array of descendant elements (document order) whose localName equals localName */
function getDescendantsByLocalName(parent, localName) {
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

/** get first descendant element's text by local name */
function getFirstDescendantText(parent, childLocalName) {
  const arr = getDescendantsByLocalName(parent, childLocalName);
  if (!arr || arr.length === 0) return '';
  return (arr[0].textContent || '').trim();
}

/**
 * generateRelativeImageMappings(xmlString, options)
 * - returns an array of mapping objects:
 *   { valuationType, propertyAnchor, categoryType, index, value, relativeXpath, imageNode }
 *
 * options:
 * - valueField (default 'ImageFileLocationIdentifier') -- which child tag's text to use as "value"
 * - includeEmptyValues (default false) -- whether mappings with empty value should be returned
 * - elementsToIncludeInPath (default ['PROPERTY']) -- array of local names to insert before IMAGE in the relative xpath
 * - namespacePrefix (default undefined) -- when provided (e.g. 'd'), output XPaths will include this prefix before element names
 *
 * The relative XPath format uses local (no-prefix) names by default:
 *   .//[ELEMENTS/...]IMAGE[ImageCategoryType='...'][n]/ImageFileLocationIdentifier
 * If namespacePrefix is set, element names in the XPath are prefixed: d:PROPERTY, d:IMAGE, etc.
 */
function generateRelativeImageMappings(xmlString, options = {}) {
  const valueField = options.valueField || 'ImageFileLocationIdentifier';
  const includeEmptyValues = !!options.includeEmptyValues;
  // default to PROPERTY when caller didn't supply elementsToIncludeInPath (undefined)
  const rawElements = Array.isArray(options.elementsToIncludeInPath) ? options.elementsToIncludeInPath : ['PROPERTY'];

const namespacePrefix = options.hasOwnProperty('namespacePrefix')
  ? (options.namespacePrefix ? String(options.namespacePrefix).trim() : null)
  : 'd';
const useNamespace = !!namespacePrefix;


  // normalize elements: strip prefixes and trim
  const elementsToInclude = rawElements.map(e => stripPrefix(String(e).trim())).filter(e => e.length > 0);

  // helper to build a possibly-prefixed name for the output XPath
  function qName(localName) {
    return useNamespace ? `${namespacePrefix}:${localName}` : localName;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const err = doc.getElementsByTagName('parsererror');
  if (err && err.length) {
    throw new Error('XML parse error: ' + new XMLSerializer().serializeToString(err[0]));
  }

  // collect PROPERTY elements by local name
  const all = doc.getElementsByTagName('*');
  const properties = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const ln = el.localName || el.tagName || '';
    if (ln === 'PROPERTY') properties.push(el);
  }

  const mappings = [];

  properties.forEach((prop) => {
    // valuation type (try attribute name as-is)
    const valuationType = (prop.getAttribute && (prop.getAttribute('ValuationUseType') ?? prop.getAttribute('valuationusetype'))) || '';

    // property anchor (use ValuationUseType if present; else a positional fallback)
    let propertyAnchor;
    if (valuationType && valuationType.trim().length > 0) {
      propertyAnchor = `//${qName('PROPERTY')}[@ValuationUseType=${formatXPathLiteral(valuationType.trim())}]`;
    } else {
      // positional fallback: index among document PROPERTY elements
      const idx = properties.indexOf(prop);
      propertyAnchor = `(/${qName('PROPERTY')})[${idx + 1}]`;
    }

    // find all IMAGE descendants under this property (DOM lookup uses localName)
    const images = getDescendantsByLocalName(prop, 'IMAGE');

    // group by ImageCategoryType (preserve order)
    const groups = {};
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const cat = getFirstDescendantText(img, 'ImageCategoryType') || '';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(img);
    }

    // create mapping objects for each image in each group
    Object.keys(groups).forEach((catValue) => {
      const group = groups[catValue];
      for (let i = 0; i < group.length; i++) {
        const imgNode = group[i];
        const indexInGroup = i + 1; // 1-based index among same-category images within this PROPERTY
        const value = getFirstDescendantText(imgNode, valueField);

        if (!includeEmptyValues && (!value || value.length === 0)) {
          // skip if value is empty and includeEmptyValues is false
          continue;
        }

        const catLiteral = formatXPathLiteral(catValue);

        // Build elements path segment: use qName() for output names
        // elementsToInclude contains local names (e.g. ['PROPERTY'] or ['IMAGES','SET'])
        const elementsSegment = elementsToInclude.length > 0
          ? elementsToInclude.map(local => qName(local)).join('/')
          : '';

        // Decide separator between the elements segment and IMAGE:
        // - If the last element's local name is 'PROPERTY' (default), use descendant '//' because IMAGE may be deeper.
        // - Otherwise use single-child '/'
        let separatorBeforeImage = '/';
        if (elementsToInclude.length === 0) {
          separatorBeforeImage = '//';
        } else {
          const lastLocal = elementsToInclude[elementsToInclude.length - 1];
          separatorBeforeImage = (String(lastLocal).toUpperCase() === 'PROPERTY') ? '//' : '/';
        }

        // prefix is either e.g. "d:PROPERTY//" or "d:IMAGES/d:SET/"
        const prefix = elementsSegment ? (elementsSegment + separatorBeforeImage) : '';

        // For element names in the predicate and the final node, use qName too:
        const imageQName = qName('IMAGE');
        const categoryQName = qName('ImageCategoryType');
        const valueFieldQName = qName(valueField);

        // Final relative xpath: .//[prefix]IMAGE[ImageCategoryType=...][n]/valueField
        const relativeXpath = `.//${prefix}${imageQName}[${categoryQName}=${catLiteral}][${indexInGroup}]/${valueFieldQName}`;

        mappings.push({
          valuationType: valuationType,
          propertyAnchor,
          categoryType: catValue,
          index: indexInGroup,
          value,
          relativeXpath,
          // imageNode included for callers that want to inspect DOM (not serialized)
          imageNode: imgNode
        });
      }
    });
  });

  return mappings;
}

/**
 * buildLinesFromMappings(mappings)
 * returns a string with lines "value : relativeXpath" separated by newlines
 */
function buildLinesFromMappings(mappings) {
  const lines = mappings.map(m => `${m.value} : ${m.relativeXpath}`);
  return lines.join('\n');
}

// ----------------- CLI runner (simplified) -----------------
function main() {
  try {
    const argv = process.argv.slice(2);
    if (argv.length < 2) {
      console.error('Usage: node image-mapper-relative-simple.js input.xml output.txt');
      process.exit(1);
    }
    const inputPath = path.resolve(argv[0]);
    const outputPath = path.resolve(argv[1]);

    if (!fs.existsSync(inputPath)) {
      console.error('Input file not found:', inputPath);
      process.exit(1);
    }

    const xml = fs.readFileSync(inputPath, 'utf8');

    // generate mappings (default: use ImageFileLocationIdentifier as value)
    // Note: CLI intentionally does not accept namespacePrefix or elementsToIncludeInPath.
    const mappings = generateRelativeImageMappings(xml, {
      valueField: 'ImageFileLocationIdentifier',
      includeEmptyValues: false
      // elementsToIncludeInPath and namespacePrefix are left undefined so defaults apply
    });

    if (mappings.length === 0) {
      console.log('No mappings found (no IMAGE with non-empty ImageFileLocationIdentifier).');
      fs.writeFileSync(outputPath, '', 'utf8');
      process.exit(0);
    }

    const lines = buildLinesFromMappings(mappings);
    fs.writeFileSync(outputPath, lines, 'utf8');
    console.log(`Wrote ${mappings.length} lines to ${outputPath}`);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

// run if executed directly
if (require.main === module) main();

// exports for programmatic use
module.exports = {
  generateRelativeImageMappings,
  buildLinesFromMappings
};
