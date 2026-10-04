import fs from 'fs';
import path from 'path';
import GeminiClient from './gemini-client.js';
import KeyRotator from './key-rotator.js';

class BatchGenerator {
  constructor(config, logger) {
    this.logger = logger;
    this.config = config;
    this.client = new GeminiClient(logger);
    this.rotator = new KeyRotator(config.apiKeys, {
      rateLimitIntervalMs: config.rateLimitIntervalMs || 4200,
      maxRetries: config.maxRetries || 5,
    });
    this.outputDir = config.outputDir || './output';
    this.concurrency = config.apiKeys.length * (config.concurrencyPerKey || 2);
    this.results = { success: 0, failed: 0, skipped: 0, errors: [] };
    this.aborted = false;
  }

  loadPrompts(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const raw = fs.readFileSync(filePath, 'utf-8');

    if (ext === '.json') {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : data.prompts || [];
    }

    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];

    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('prompt') || header.includes('id');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line, i) => {
      const parts = this._parseCSVLine(line);
      if (parts.length >= 2) {
        return { id: parts[0].trim(), prompt: parts.slice(1).join(',').trim() };
      }
      return { id: String(i + 1), prompt: line.trim() };
    }).filter(p => p.prompt);
  }

  _parseCSVLine(line) {
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { parts.push(current); current = ''; continue; }
      current += ch;
    }
    parts.push(current);
    return parts;
  }

  async generateImages(prompts, opts = {}) {
    const model = opts.model || this.config.imageModel || 'gemini-2.0-flash-exp';
    const outDir = path.join(this.outputDir, 'images');
    fs.mkdirSync(outDir, { recursive: true });

    this.logger.info(`Starting batch image generation: ${prompts.length} prompts, ${this.concurrency} workers, model=${model}`);
    return this._runBatch(prompts, async (entry, keyEntry) => {
      const res = await this.client.generateImage(keyEntry.key, entry.prompt, model, {
        timeout: opts.timeout || 120000,
        temperature: opts.temperature,
      });

      if (!res.success) throw new Error(res.error || `HTTP ${res.status}`);

      const saved = [];
      for (let j = 0; j < res.images.length; j++) {
        const ext = res.images[j].mimeType.includes('png') ? 'png' : 'jpg';
        const filename = `${this._sanitize(entry.id)}_${j}.${ext}`;
        const outPath = path.join(outDir, filename);
        fs.writeFileSync(outPath, res.images[j].data);
        saved.push(outPath);
      }
      return saved;
    });
  }

  async generateVideos(prompts, opts = {}) {
    const model = opts.model || this.config.videoModel || 'veo-2.0-generate-001';
    const outDir = path.join(this.outputDir, 'videos');
    fs.mkdirSync(outDir, { recursive: true });

    this.logger.info(`Starting batch video generation: ${prompts.length} prompts, ${this.concurrency} workers, model=${model}`);
    return this._runBatch(prompts, async (entry, keyEntry) => {
      const res = await this.client.generateVideo(keyEntry.key, entry.prompt, model, {
        timeout: opts.timeout || 300000,
        temperature: opts.temperature,
      });

      if (!res.success) throw new Error(res.error || `HTTP ${res.status}`);

      const saved = [];
      for (let j = 0; j < res.media.length; j++) {
        const ext = (res.media[j].mimeType || '').includes('mp4') ? 'mp4' : 'webm';
        const filename = `${this._sanitize(entry.id)}_${j}.${ext}`;
        const outPath = path.join(outDir, filename);
        fs.writeFileSync(outPath, res.media[j].data);
        saved.push(outPath);
      }
      return saved;
    });
  }

  async generateImagesWithRef(prompts, refImagePath, opts = {}) {
    const model = opts.model || this.config.imageModel || 'gemini-2.0-flash-exp';
    const outDir = path.join(this.outputDir, 'images');
    fs.mkdirSync(outDir, { recursive: true });

    this.logger.info(`Starting batch image+ref generation: ${prompts.length} prompts, ref=${refImagePath}`);
    return this._runBatch(prompts, async (entry, keyEntry) => {
      const res = await this.client.generateImageWithRef(keyEntry.key, entry.prompt, refImagePath, model, {
        timeout: opts.timeout || 120000,
      });

      if (!res.success) throw new Error(res.error || `HTTP ${res.status}`);

      const saved = [];
      for (let j = 0; j < res.images.length; j++) {
        const ext = res.images[j].mimeType.includes('png') ? 'png' : 'jpg';
        const filename = `${this._sanitize(entry.id)}_${j}.${ext}`;
        const outPath = path.join(outDir, filename);
        fs.writeFileSync(outPath, res.images[j].data);
        saved.push(outPath);
      }
      return saved;
    });
  }

  async _runBatch(prompts, taskFn) {
    const total = prompts.length;
    this.results = { success: 0, failed: 0, skipped: 0, errors: [] };
    this.aborted = false;
    const startTime = Date.now();
    let completed = 0;

    const queue = prompts.map((p, i) => ({ ...p, _index: i }));
    const workers = [];

    for (let w = 0; w < this.concurrency; w++) {
      workers.push(this._worker(w, queue, taskFn, () => {
        completed++;
        this.logger.progress(completed, total, `ok:${this.results.success} fail:${this.results.failed}`);
      }));
    }

    await Promise.all(workers);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.info('');
    this.logger.info(`Batch complete: ${this.results.success} succeeded, ${this.results.failed} failed in ${elapsed}s`);
    this.logger.info(`Throughput: ${(this.results.success / (elapsed / 60)).toFixed(1)} items/min`);

    if (this.results.errors.length > 0) {
      const errorLog = path.join(this.outputDir, 'errors.json');
      fs.writeFileSync(errorLog, JSON.stringify(this.results.errors, null, 2));
      this.logger.info(`Error details saved to ${errorLog}`);
    }

    return this.results;
  }

  async _worker(id, queue, taskFn, onComplete) {
    while (queue.length > 0 && !this.aborted) {
      const entry = queue.shift();
      if (!entry) break;

      let retries = 0;
      let success = false;

      while (retries <= this.config.maxRetries && !this.aborted) {
        const keyEntry = await this.rotator.waitForKey();

        try {
          await taskFn(entry, keyEntry);
          this.rotator.markSuccess(keyEntry);
          this.results.success++;
          success = true;
          break;
        } catch (err) {
          const status = this._extractStatus(err);
          const backoff = this.rotator.markError(keyEntry, status);

          if (status === 429 || status === 503) {
            this.logger.debug(`Worker ${id}: rate limited on "${entry.id}", retry ${retries + 1} (backoff ${backoff}ms)`);
            retries++;
            continue;
          }

          if (status >= 500 && retries < this.config.maxRetries) {
            retries++;
            await new Promise(r => setTimeout(r, 2000 * retries));
            continue;
          }

          this.logger.debug(`Worker ${id}: failed "${entry.id}": ${err.message}`);
          this.results.failed++;
          this.results.errors.push({ id: entry.id, prompt: entry.prompt, error: err.message, retries });
          break;
        }
      }

      if (!success && retries > this.config.maxRetries) {
        this.results.failed++;
        this.results.errors.push({ id: entry.id, prompt: entry.prompt, error: 'Max retries exceeded', retries });
      }

      onComplete();
    }
  }

  _extractStatus(err) {
    const match = err.message?.match(/HTTP (\d+)/);
    if (match) return parseInt(match[1]);
    if (err.message?.includes('Rate limited')) return 429;
    if (err.message?.includes('timeout')) return 408;
    return 0;
  }

  _sanitize(name) {
    return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
  }

  abort() {
    this.aborted = true;
    this.logger.warn('Batch generation aborted');
  }

  getStats() {
    return {
      ...this.results,
      keys: this.rotator.getStats(),
    };
  }
}

export default BatchGenerator;
