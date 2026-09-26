// Lecture de JSON "avec commentaires" (JSONC) : // ... , /* ... */ et virgules finales.
import fs from 'node:fs';

export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  // virgules finales : , } ou , ]  (hors chaines, les chaines ont deja ete recopiees telles quelles)
  return removeTrailingCommas(out);
}

function removeTrailingCommas(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i++; } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

export function parseJsonc(text, source = 'json') {
  const clean = stripJsonComments(text.replace(/^﻿/, ''));
  try {
    return JSON.parse(clean);
  } catch (err) {
    throw new Error(`${source} : JSON invalide (${err.message})`);
  }
}

export function readJsoncFile(file) {
  return parseJsonc(fs.readFileSync(file, 'utf8'), file);
}
