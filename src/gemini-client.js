import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://generativelanguage.googleapis.com';

class GeminiClient {
  constructor(logger) {
    this.logger = logger;
  }

  _buildUrl(model, method, apiKey) {
    return `${BASE_URL}/v1beta/models/${model}:${method}?key=${apiKey}`;
  }

  _request(url, body, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const data = JSON.stringify(body);
      const mod = parsed.protocol === 'https:' ? https : http;

      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw), raw });
          } catch {
            resolve({ status: res.statusCode, data: null, raw });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(data);
      req.end();
    });
  }

  async generateImage(apiKey, prompt, model = 'gemini-2.0-flash-exp', opts = {}) {
    const url = this._buildUrl(model, 'generateContent', apiKey);
    const body = {
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(opts.temperature && { temperature: opts.temperature }),
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    const res = await this._request(url, body, opts.timeout || 120000);
    return this._parseImageResponse(res);
  }

  async generateVideo(apiKey, prompt, model = 'veo-2.0-generate-001', opts = {}) {
    const url = this._buildUrl(model, 'generateContent', apiKey);
    const body = {
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ['VIDEO'],
        ...(opts.temperature && { temperature: opts.temperature }),
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    const res = await this._request(url, body, opts.timeout || 300000);
    return this._parseMediaResponse(res, 'video');
  }

  async generateImageWithRef(apiKey, prompt, refImagePath, model = 'gemini-2.0-flash-exp', opts = {}) {
    const imageData = fs.readFileSync(refImagePath);
    const base64 = imageData.toString('base64');
    const ext = path.extname(refImagePath).slice(1).toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const mimeType = mimeMap[ext] || 'image/png';

    const url = this._buildUrl(model, 'generateContent', apiKey);
    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    const res = await this._request(url, body, opts.timeout || 120000);
    return this._parseImageResponse(res);
  }

  async chat(apiKey, messages, model = 'gemini-2.5-flash', opts = {}) {
    const url = this._buildUrl(model, 'generateContent', apiKey);
    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: {
        temperature: opts.temperature || 1.0,
        maxOutputTokens: opts.maxTokens || 8192,
      },
    };

    const res = await this._request(url, body, opts.timeout || 60000);
    if (res.status !== 200) {
      return { success: false, status: res.status, error: res.raw };
    }

    const text = res.data?.candidates?.[0]?.content?.parts
      ?.filter(p => p.text)
      ?.map(p => p.text)
      ?.join('') || '';

    return { success: true, text, usage: res.data?.usageMetadata };
  }

  _parseImageResponse(res) {
    if (res.status === 429) return { success: false, status: 429, error: 'Rate limited' };
    if (res.status === 503) return { success: false, status: 503, error: 'Service unavailable' };
    if (res.status !== 200) return { success: false, status: res.status, error: res.raw?.substring(0, 500) };

    const candidates = res.data?.candidates;
    if (!candidates?.length) {
      const blockReason = res.data?.promptFeedback?.blockReason;
      return { success: false, status: res.status, error: `Blocked: ${blockReason || 'unknown'}` };
    }

    const parts = candidates[0]?.content?.parts || [];
    const images = [];
    let text = '';

    for (const part of parts) {
      if (part.inlineData) {
        images.push({
          data: Buffer.from(part.inlineData.data, 'base64'),
          mimeType: part.inlineData.mimeType || 'image/png',
        });
      }
      if (part.text) text += part.text;
    }

    if (images.length === 0) {
      return { success: false, status: res.status, error: 'No image in response', text };
    }

    return { success: true, images, text, usage: res.data?.usageMetadata };
  }

  _parseMediaResponse(res, type) {
    if (res.status === 429) return { success: false, status: 429, error: 'Rate limited' };
    if (res.status === 503) return { success: false, status: 503, error: 'Service unavailable' };
    if (res.status !== 200) return { success: false, status: res.status, error: res.raw?.substring(0, 500) };

    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const media = [];

    for (const part of parts) {
      if (part.inlineData) {
        media.push({
          data: Buffer.from(part.inlineData.data, 'base64'),
          mimeType: part.inlineData.mimeType,
        });
      }
    }

    if (media.length === 0) {
      return { success: false, status: res.status, error: `No ${type} in response` };
    }

    return { success: true, media, usage: res.data?.usageMetadata };
  }
}

export default GeminiClient;
