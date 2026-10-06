#!/usr/bin/env node

/**
 * x-comics generate.js — Gemini image generation with character reference support
 *
 * Usage:
 *   node generate.js -p "scene prompt" -o output.png [-r ref1.png ref2.png] [-a 1:1]
 *
 * Passes reference images as inlineData to Gemini generateContent
 * for character-consistent comic panel generation.
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { parseArgs } from 'node:util';

const VALID_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  return map[ext] || 'image/png';
}

function loadImageAsBase64(filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Reference image not found: ${resolved}`);
  }
  const buffer = readFileSync(resolved);
  return {
    data: buffer.toString('base64'),
    mimeType: getMimeType(resolved)
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      prompt:        { type: 'string',  short: 'p' },
      output:        { type: 'string',  short: 'o' },
      'aspect-ratio':{ type: 'string',  short: 'a', default: '1:1' },
      model:         { type: 'string',  short: 'm', default: DEFAULT_MODEL },
      reference:     { type: 'string',  short: 'r', multiple: true },
      help:          { type: 'boolean', short: 'h', default: false }
    },
    strict: true
  });

  if (values.help) {
    console.log(`
x-comics generate — Character-consistent image generation via Gemini

Options:
  -p, --prompt         Scene prompt (required)
  -o, --output         Output file path (required)
  -a, --aspect-ratio   Aspect ratio: ${VALID_ASPECT_RATIOS.join(', ')} (default: 1:1)
  -m, --model          Gemini model (default: ${DEFAULT_MODEL})
  -r, --reference      Reference image path(s) — repeat for multiple characters
  -h, --help           Show this help

Examples:
  # Generate with character reference
  node generate.js -p "Character A walking through a rainy city" -o panel1.png -r char-a.png

  # Multiple character references
  node generate.js -p "Character A and B in conversation" -o panel2.png -r char-a.png -r char-b.png
`);
    process.exit(0);
  }

  if (!values.prompt) {
    console.log(JSON.stringify({ success: false, error: 'Missing required argument: --prompt' }));
    process.exit(1);
  }

  if (!values.output) {
    console.log(JSON.stringify({ success: false, error: 'Missing required argument: --output' }));
    process.exit(1);
  }

  const aspectRatio = values['aspect-ratio'];
  if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
    console.log(JSON.stringify({ success: false, error: `Invalid aspect ratio: ${aspectRatio}` }));
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log(JSON.stringify({ success: false, error: 'GEMINI_API_KEY environment variable not set' }));
    process.exit(1);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Build contents array: reference images first, then text prompt
    const contentParts = [];

    const refs = values.reference || [];
    for (let i = 0; i < refs.length; i++) {
      const imgData = loadImageAsBase64(refs[i]);
      contentParts.push({
        inlineData: { mimeType: imgData.mimeType, data: imgData.data }
      });
    }

    // Add the text prompt last — Gemini reads images then follows text instructions
    contentParts.push({ text: values.prompt });

    const config = {
      responseModalities: ['IMAGE']
    };
    if (aspectRatio) {
      config.imageConfig = { aspectRatio };
    }

    const response = await ai.models.generateContent({
      model: values.model,
      contents: contentParts,
      config
    });

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      console.log(JSON.stringify({ success: false, error: 'No candidates in response' }));
      process.exit(1);
    }

    const parts = candidates[0].content?.parts;
    if (!parts) {
      console.log(JSON.stringify({ success: false, error: 'No content parts in response' }));
      process.exit(1);
    }

    let imageData = null;
    for (const part of parts) {
      if ('inlineData' in part && part.inlineData) {
        imageData = part.inlineData;
        break;
      }
    }

    if (!imageData) {
      console.log(JSON.stringify({ success: false, error: 'No image data in response' }));
      process.exit(1);
    }

    // Save the image
    const outPath = resolve(values.output);
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }
    writeFileSync(outPath, Buffer.from(imageData.data, 'base64'));

    console.log(JSON.stringify({ success: true, filePath: outPath }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ success: false, error: `Gemini API error: ${msg}` }));
    process.exit(1);
  }
}

main();
