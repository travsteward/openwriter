/**
 * Image upload and static serving for OpenWriter.
 * Images are stored in {DATA_DIR}/_images/ and referenced as relative paths in markdown.
 */

import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR, ensureDataDir } from './helpers.js';
import express from 'express';

const IMAGES_DIR = join(DATA_DIR, '_images');

function ensureImagesDir(): void {
  ensureDataDir();
  if (!existsSync(IMAGES_DIR)) mkdirSync(IMAGES_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureImagesDir();
    cb(null, IMAGES_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || '.png';
    cb(null, `${randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

export function createImageRouter(): Router {
  const router = Router();

  // Static serving for images
  ensureImagesDir();
  router.use('/_images', express.static(IMAGES_DIR));

  // Upload endpoint
  router.post('/api/upload-image', upload.single('image'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }
    const src = `/_images/${req.file.filename}`;
    res.json({ src });
  });

  return router;
}
