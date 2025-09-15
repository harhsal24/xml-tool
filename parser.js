// parser.js
// Usage:
//   node parser.js                    -> uses defaults (./input/sample.xml -> ./output/sample.txt)
//   node parser.js input.xml out.txt  -> uses provided paths

const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

// ----------------- Helper utilities -----------------

/**
 * Format an XPath literal safely (handles values containing both single and double quotes).
 * Returns a string suitable to put after = in an XPath predicate, e.g. "'abc'" or "concat('a', '\"', 'b')"
 */
function formatXPathLiteral(value) {
  if (value.indexOf("'") === -1) {
    return `'${value}'`;
  }
  if (value.indexOf('"') === -1) {
    return `"${value}"`;
  }
  // contains both single and double quotes -> use concat()
  const parts = value.split("'");
  const concatParts = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) concatParts.push(`'${parts[i]}'`);
    if (i < parts.length - 1) concatParts.push(`"'"`);
  }
  return `concat(${concatParts.join(',')})`;
}

/** strip namespace prefix if present, e.g. d:PROPERTY -> PROPERTY */
function stripPrefix(tagName) {
  const idx = tagName.indexOf(':');
  return idx === -1 ? tagName : tagName.substring(idx + 1);
}

/**
 * Build the xpath step for a node using configured attributes and parent-scope indexing rules.
 * - node: DOM element
 * - parent: DOM element (may be null for root)
 * - options: config object
 */
function makeXPathStep(node, parent, options) {
  // tag name preserves namespace prefix if present (e.g. d:PROPERTY)
  const tag = node.tagName;
  const attrsToUse = Array.isArray(options.attributesToIncludeInPath) ? options.attributesToIncludeInPath : [];

  // detect leaf status here for leaf-node-specific rules
  const isLeaf = !Array.from(node.childNodes).some(n => n.nodeType === 1);

  // 1) build attribute predicates in specified order
  const attrPredicates = [];
  for (const attrName of attrsToUse) {
    if (node.hasAttribute && node.hasAttribute(attrName)) {
      const raw = String(node.getAttribute(attrName) ?? '');
      if (raw.length > 0) {
        attrPredicates.push(`@${attrName}=${formatXPathLiteral(raw)}`);
      }
    }
  }

  // 2) compute whether numeric index is required in parent scope
  let numericIndex = null;
  // keep siblingsSameTag in scope so leaf-node policies can use it
  let siblingsSameTag = [];
  if (parent) {
    const parentChildren = Array.from(parent.childNodes).filter(n => n.nodeType === 1);
    siblingsSameTag = parentChildren.filter(c => c.tagName === tag);

    if (siblingsSameTag.length > 1) {
      if (attrPredicates.length === 0) {
        // no attribute-based distinguishing: index among all siblings with same tag
        numericIndex = siblingsSameTag.indexOf(node) + 1;
      } else {
        // attributes exist: see whether they uniquely identify this node among siblings with same tag
        const sameAttrSiblings = siblingsSameTag.filter(s => {
          return attrsToUse.every(a => {
            const sa = (s.getAttribute && s.getAttribute(a) !== null) ? String(s.getAttribute(a)) : undefined;
            const na = (node.getAttribute && node.getAttribute(a) !== null) ? String(node.getAttribute(a)) : undefined;
            // require exact match
            return sa === na;
          });
        });

        if (sameAttrSiblings.length > 1) {
          // attribute set does not uniquely identify this node -> index within that subset
          numericIndex = sameAttrSiblings.indexOf(node) + 1;
        } else {
          // unique by attributes -> no numeric index required
          numericIndex = null;
        }
      }
    } else {
      // only one sibling with same tag under parent -> no numeric index required (may be forced later)
      numericIndex = null;
    }
  }

  // 2b) apply leaf-node indexing policy (option: 'auto'|'always'|'never')
  const leafPolicy = options.leafNodeIndexing || 'auto';
  if (isLeaf) {
    if (leafPolicy === 'never') {
      // never include numeric index for leaf nodes
      numericIndex = null;
    } else if (leafPolicy === 'always') {
      // always include numeric index for leaf nodes when parent exists.
      // compute fallback index even if attributes would have made numericIndex null.
      if (parent) {
        // compute index among siblings with same tag (if none, fall back to 1)
        const idx = siblingsSameTag && siblingsSameTag.length ? (siblingsSameTag.indexOf(node) + 1) : 1;
        numericIndex = idx;
        // respect exceptions to showing [1]
        const isException = Array.isArray(options.exceptionsToIndexOneForcing) &&
          (options.exceptionsToIndexOneForcing.includes(tag) || options.exceptionsToIndexOneForcing.includes(stripPrefix(tag)));
        if (numericIndex === 1 && isException) {
          numericIndex = null;
        }
      } else {
        // root/parentless node: do not add numeric index
        numericIndex = null;
      }
    }
    // 'auto' => leave numericIndex as originally computed
  }

  // 3) determine whether to force [1] when numericIndex === null (existing behavior)
  let predicateStr = '';
  if (attrPredicates.length > 0) {
    predicateStr += `[${attrPredicates.join(' and ')}]`;
  }
  if (numericIndex !== null) {
    predicateStr += `[${numericIndex}]`;
  } else if (numericIndex === null) {
    // possible forced [1] when there was no numericIndex computed:
    // If forceIndexOneFor is an array and length === 0 => force for ALL tags
    // Or if the tag is included explicitly in forceIndexOneFor
    if (Array.isArray(options.forceIndexOneFor)) {
      const forceForAll = options.forceIndexOneFor.length === 0;
      const forceForSpecific = options.forceIndexOneFor.includes(tag) || options.forceIndexOneFor.includes(stripPrefix(tag));
      const isException = Array.isArray(options.exceptionsToIndexOneForcing) &&
                          (options.exceptionsToIndexOneForcing.includes(tag) || options.exceptionsToIndexOneForcing.includes(stripPrefix(tag)));
      if ((forceForAll || forceForSpecific) && !isException) {
        // show [1]
        predicateStr += `[1]`;
      }
    }
  }

  return `${tag}${predicateStr}`;
}

/**
 * Build absolute XPath for current node using ancestor chain.
 * ancestors: array of nodes from root ... to current (inclusive)
 */
function buildAbsoluteXPathFromAncestors(ancestors, options) {
  const steps = [];
  for (let i = 0; i < ancestors.length; i++) {
    const node = ancestors[i];
    const parent = i > 0 ? ancestors[i - 1] : null;
    steps.push(makeXPathStep(node, parent, options));
  }
  return '/' + steps.join('/');
}

// ----------------- Core traversal / generator -----------------

/**
 * Generate lines "value : /ABSOLUTE/XPATH" for leaf nodes.
 * xmlString: full XML content
 * options: configuration object
 */
function generateXpathList(xmlString, options) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const errorNode = doc.getElementsByTagName('parsererror');
  if (errorNode && errorNode.length > 0) {
    // serialize parsererror details
    throw new Error('XML Parsing Error: ' + new XMLSerializer().serializeToString(errorNode[0]));
  }

  const results = [];
  if (!doc.documentElement) return '';

  // recursively walk and maintain ancestor stack
  function walk(node, ancestors) {
    if (!node || node.nodeType !== 1) return; // element nodes only

    // Skip configured ignored leaf nodes (by tag name WITHOUT assuming namespace)
    const bareTag = stripPrefix(node.tagName);
    if (Array.isArray(options.ignoreLeafNodes) && options.ignoreLeafNodes.includes(node.tagName)) return;
    if (Array.isArray(options.ignoreLeafNodes) && options.ignoreLeafNodes.includes(bareTag)) return;

    // find element children
    const childElements = Array.from(node.childNodes).filter(n => n.nodeType === 1);

    // leaf = no element children, and some non-empty text content
    if (childElements.length === 0) {
      const txt = node.textContent ? node.textContent.trim() : '';
      if (txt.length > 0) {
        const abs = buildAbsoluteXPathFromAncestors(ancestors.concat(node), options);
        results.push(`${txt} : ${abs}`);
      }
      return;
    }

    // for each child, we must pass ancestor context; numeric indexing logic is computed in makeXPathStep
    for (const child of childElements) {
      walk(child, ancestors.concat(node));
    }
  }

  walk(doc.documentElement, []); // start with root element (ancestors empty)
  return results.join('\n');
}

// ----------------- Default configuration -----------------

const defaultOptions = {
  // Default I/O paths (relative to this script folder)
  inputFile: path.join(__dirname, 'input', 'sample.xml'),
  outputFile: path.join(__dirname, 'output', 'sample.txt'),

  // INDEXING: set [] to force index [1] for ALL tags
  forceIndexOneFor: [],

  // exceptions to the force rule above (never show [1] even if forcing)
  // can include names with or without namespace prefix (e.g. 'd:PROPERTY' or 'PROPERTY')
  exceptionsToIndexOneForcing: [
    'MESSAGE',
    'DOCUMENT_SETS', 'DOCUMENT_SET',
    'DOCUMENTS', 'DOCUMENT',
    'DEAL_SETS', 'DEAL_SET',
    'DEALS', 'DEAL',
    'SERVICES', 'SERVICE',
    'VALUATION', 'VALUATION_RESPONSE',
    'VALUATION_ANALYSES', 'VALUATION_ANALYSIS',
    'PROPERTIES'
  ],

  // ATTRIBUTES to prefer for predicates (kept to ValuationUseType as requested)
  attributesToIncludeInPath: ['ValuationUseType'],

  // IGNORE leaf node tags (no output lines created for these tags)
  ignoreLeafNodes: [
    // 'ImageFileLocationIdentifier'
  ],

  // NEW: control leaf-node indexing behavior:
  // 'auto'   -> default behavior (index only when needed to disambiguate)
  // 'always' -> always include numeric index for leaf nodes (respects exceptionsToIndexOneForcing)
  // 'never'  -> never include numeric index for leaf nodes (even if needed)
  leafNodeIndexing: 'auto'
};

// ----------------- Main CLI flow -----------------

function resolveOptionValue(cliValue, defaultValue) {
  if (!cliValue) return defaultValue;
  return path.resolve(cliValue);
}

function main() {
  try {
    // CLI args: [node, parser.js, inputPath?, outputPath?]
    const argv = process.argv.slice(2);
    let inputPath = argv[0] ? path.resolve(argv[0]) : defaultOptions.inputFile;
    let outputPath = argv[1] ? path.resolve(argv[1]) : defaultOptions.outputFile;

    // If inputPath points to a bare filename inside input folder, allow that UX:
    if (!path.isAbsolute(inputPath) && fs.existsSync(path.join(__dirname, 'input', inputPath))) {
      inputPath = path.join(__dirname, 'input', inputPath);
    }

    // Build options object to pass into generator
    const options = {
      forceIndexOneFor: Array.isArray(defaultOptions.forceIndexOneFor) ? defaultOptions.forceIndexOneFor.slice() : [],
      exceptionsToIndexOneForcing: Array.isArray(defaultOptions.exceptionsToIndexOneForcing) ? defaultOptions.exceptionsToIndexOneForcing.slice() : [],
      attributesToIncludeInPath: Array.isArray(defaultOptions.attributesToIncludeInPath) ? defaultOptions.attributesToIncludeInPath.slice() : [],
      ignoreLeafNodes: Array.isArray(defaultOptions.ignoreLeafNodes) ? defaultOptions.ignoreLeafNodes.slice() : [],
      leafNodeIndexing: defaultOptions.leafNodeIndexing || 'auto'
    };

    if (!fs.existsSync(inputPath)) {
      console.error(`✖ Input file not found: ${inputPath}`);
      console.error('Usage: node parser.js [input.xml] [output.txt]');
      process.exit(1);
    }

    // ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    console.log(`Reading XML: ${inputPath}`);
    console.log(`Writing output: ${outputPath}`);
    console.log(`Attributes used for predicates: ${options.attributesToIncludeInPath.join(', ')}`);
    console.log(`Force index [1] for: ${options.forceIndexOneFor.length === 0 ? 'ALL tags' : options.forceIndexOneFor.join(', ')}`);
    console.log(`Exceptions to force rule: ${options.exceptionsToIndexOneForcing.join(', ')}`);
    console.log(`Leaf node indexing policy: ${options.leafNodeIndexing}`);
    if (options.ignoreLeafNodes.length) {
      console.log(`Ignored leaf nodes: ${options.ignoreLeafNodes.join(', ')}`);
    }

    const xmlData = fs.readFileSync(inputPath, 'utf8');
    const outputContent = generateXpathList(xmlData, options);
    fs.writeFileSync(outputPath, outputContent, 'utf8');

    const count = outputContent.split('\n').filter(l => l.trim().length > 0).length;
    console.log(`\n✔ Done — generated ${count} lines.`);
  } catch (err) {
    console.error('✖ Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

// run
if (require.main === module) {
  main();
}

module.exports = {
  generateXpathList,
  defaultOptions
};
