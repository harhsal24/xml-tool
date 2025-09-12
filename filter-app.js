// compare_xpaths.js
// Usage: node compare_xpaths.js fileA.txt fileB.txt

const fs = require('fs');
const path = require('path');

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
}

/**
 * Parse lines and return Map(xpath -> Set(values))
 * Supports "value : /xpath", "/xpath", or "prefix /xpath".
 */
function parseFileToMap(filePath) {
  const lines = readLines(filePath);
  const map = new Map();

  for (const line of lines) {
    // try exact "value : /xpath" with last colon-style split
    let m = line.match(/^(.*?)\s*:\s*(\/.+)$/);
    let value, xpath;

    if (m) {
      value = m[1].trim();
      xpath = m[2].trim();
    } else {
      // fallback: find first slash and consider the rest as xpath
      const idx = line.indexOf('/');
      if (idx !== -1) {
        xpath = line.slice(idx).trim();
        value = line.slice(0, idx).replace(/[:\s]+$/, '').trim();
      } else {
        // can't find an xpath — skip
        continue;
      }
    }

    if (!xpath) continue;
    // normalize whitespace in xpath to single spaces and trim
    xpath = xpath.replace(/\s+/g, ' ').trim();

    const existing = map.get(xpath);
    if (!existing) {
      map.set(xpath, new Set(value ? [value] : []));
    } else {
      if (value) existing.add(value);
    }
  }

  return map;
}

function setToSortedArray(set) {
  return Array.from(set).sort();
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function writeLines(filePath, lines) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function buildLinesFromMap(map) {
  // returns array of "value :: xpath" lines; if multiple values for xpath, they are joined by " | "
  const out = [];
  const keys = Array.from(map.keys()).sort();
  for (const k of keys) {
    const vals = setToSortedArray(map.get(k));
    const valStr = vals.length ? vals.join(' | ') : '';
    out.push(valStr ? `${valStr} : ${k}` : `${k}`);
  }
  return out;
}

// --- Main ---
(function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.error('Usage: node compare_xpaths.js fileA.txt fileB.txt');
    process.exit(2);
  }

  const fileA = path.resolve(argv[0]);
  const fileB = path.resolve(argv[1]);

  if (!fs.existsSync(fileA)) { console.error('File A not found:', fileA); process.exit(1); }
  if (!fs.existsSync(fileB)) { console.error('File B not found:', fileB); process.exit(1); }

  const mapA = parseFileToMap(fileA);
  const mapB = parseFileToMap(fileB);

  const xpathsA = new Set(mapA.keys());
  const xpathsB = new Set(mapB.keys());

  const matched = [];
  const onlyA = [];
  const onlyB = [];
  const differing = [];
  const identical = [];

  for (const xp of xpathsA) {
    if (xpathsB.has(xp)) {
      matched.push(xp);
      const valsA = mapA.get(xp) || new Set();
      const valsB = mapB.get(xp) || new Set();
      if (!setsEqual(valsA, valsB)) {
        differing.push(xp);
      } else {
        identical.push(xp);
      }
    } else {
      onlyA.push(xp);
    }
  }

  for (const xp of xpathsB) {
    if (!xpathsA.has(xp)) onlyB.push(xp);
  }

  // prepare output directory = directory of fileA (if both in different dirs we pick fileA's dir)
  const outDir = path.dirname(fileA);

  // matched.txt: include values from both sides
  const matchedLines = matched.sort().map(xp => {
    const aVals = setToSortedArray(mapA.get(xp) || new Set()).join(' | ');
    const bVals = setToSortedArray(mapB.get(xp) || new Set()).join(' | ');
    return `${xp}  <-- A: ${aVals || '(empty)'}  |  B: ${bVals || '(empty)'}`;
  });

  writeLines(path.join(outDir, 'matched.txt'), matchedLines);

  // only_in_A.txt and only_in_B.txt (with values)
  writeLines(path.join(outDir, 'only_in_A.txt'), onlyA.length ? onlyA.sort().map(xp => {
    const vals = setToSortedArray(mapA.get(xp) || new Set()).join(' | ');
    return vals ? `${vals} : ${xp}` : `${xp}`;
  }) : ['(none)']);

  writeLines(path.join(outDir, 'only_in_B.txt'), onlyB.length ? onlyB.sort().map(xp => {
    const vals = setToSortedArray(mapB.get(xp) || new Set()).join(' | ');
    return vals ? `${vals} : ${xp}` : `${xp}`;
  }) : ['(none)']);

  // differing_values.txt: only xpaths present in both but values differ, show both sides
  writeLines(path.join(outDir, 'differing_values.txt'), differing.length ? differing.sort().map(xp => {
    const aVals = setToSortedArray(mapA.get(xp) || new Set()).join(' | ');
    const bVals = setToSortedArray(mapB.get(xp) || new Set()).join(' | ');
    return `${xp}\n  A: ${aVals || '(empty)'}\n  B: ${bVals || '(empty)'}\n`;
  }) : ['(none)']);

  // also write a summary file
  const summary = {
    fileA: fileA,
    fileB: fileB,
    totalXPathsA: xpathsA.size,
    totalXPathsB: xpathsB.size,
    matchedCount: matched.length,
    identicalValuesCount: identical.length,
    differingValuesCount: differing.length,
    onlyInACount: onlyA.length,
    onlyInBCount: onlyB.length,
    outputs: {
      matched: path.join(outDir, 'matched.txt'),
      only_in_A: path.join(outDir, 'only_in_A.txt'),
      only_in_B: path.join(outDir, 'only_in_B.txt'),
      differing_values: path.join(outDir, 'differing_values.txt')
    }
  };
  writeLines(path.join(outDir, 'summary.json'), [JSON.stringify(summary, null, 2)]);

  // console summary
  console.log('Comparison finished.');
  console.log(`A: ${summary.totalXPathsA} xpaths  |  B: ${summary.totalXPathsB} xpaths`);
  console.log(`Matched: ${summary.matchedCount} (identical values: ${summary.identicalValuesCount}, differing: ${summary.differingValuesCount})`);
  console.log(`Only in A: ${summary.onlyInACount}   Only in B: ${summary.onlyInBCount}`);
  console.log('Outputs written to:', outDir);
})();
