import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';

class StudioProxyClient {
  constructor(logger, baseUrl = 'http://127.0.0.1:2048') {
    this.logger = logger;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  _request(urlStr, body, apiKey, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const data = JSON.stringify(body);
      const mod = parsed.protocol === 'https:' ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers,
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
    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(opts.temperature && { temperature: opts.temperature }),
      },
    };

    const res = await this._request(url, body, apiKey, opts.timeout || 120000);
    return this._parseImageResponse(res);
  }

  async generateVideo(apiKey, prompt, model = 'veo-2.0-generate-001', opts = {}) {
    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ['VIDEO'],
        ...(opts.temperature && { temperature: opts.temperature }),
      },
    };

    const res = await this._request(url, body, apiKey, opts.timeout || 300000);
    return this._parseMediaResponse(res, 'video');
  }

  async generateImageWithRef(apiKey, prompt, refImagePath, model = 'gemini-2.0-flash-exp', opts = {}) {
    const imageData = fs.readFileSync(refImagePath);
    const base64 = imageData.toString('base64');
    const ext = path.extname(refImagePath).slice(1).toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const mimeType = mimeMap[ext] || 'image/png';

    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent`;
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
    };

    const res = await this._request(url, body, apiKey, opts.timeout || 120000);
    return this._parseImageResponse(res);
  }

  async generateImageOpenAI(apiKey, prompt, model = 'gemini-2.0-flash-exp', opts = {}) {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['text', 'image'],
      ...(opts.temperature && { temperature: opts.temperature }),
    };

    const res = await this._request(url, body, apiKey, opts.timeout || 120000);
    if (res.status !== 200) {
      return { success: false, status: res.status, error: res.raw?.substring(0, 500) };
    }

    const choices = res.data?.choices || [];
    const images = [];
    let text = '';

    for (const choice of choices) {
      const content = choice.message?.content;
      if (typeof content === 'string') {
        text += content;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'image_url' && part.image_url?.url) {
            const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              images.push({
                data: Buffer.from(match[2], 'base64'),
                mimeType: match[1],
              });
            }
          }
          if (part.type === 'text') text += part.text || '';
        }
      }
    }

    if (images.length === 0) {
      return { success: false, status: res.status, error: 'No image in response', text };
    }

    return { success: true, images, text, usage: res.data?.usage };
  }

  async chat(apiKey, messages, model = 'gemini-2.5-flash', opts = {}) {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      temperature: opts.temperature || 1.0,
      max_tokens: opts.maxTokens || 8192,
    };

    const res = await this._request(url, body, apiKey, opts.timeout || 60000);
    if (res.status !== 200) {
      return { success: false, status: res.status, error: res.raw };
    }

    const text = res.data?.choices?.[0]?.message?.content || '';
    return { success: true, text, usage: res.data?.usage };
  }

  async healthCheck() {
    try {
      const parsed = new URL(this.baseUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      return new Promise((resolve) => {
        const req = mod.get(`${this.baseUrl}/v1/models`, { timeout: 5000 }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            resolve({ ok: res.statusCode === 200, status: res.statusCode });
          });
        });
        req.on('error', () => resolve({ ok: false, error: 'Connection refused' }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
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

export default StudioProxyClient;
