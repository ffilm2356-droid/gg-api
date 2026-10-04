#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import BatchGenerator from './batch-generator.js';
import StudioProxyClient from './studio-proxy-client.js';
import Logger from './logger.js';

const logger = new Logger(process.env.LOG_LEVEL || 'info');

function loadConfig() {
  const proxyUrl = process.env.PROXY_URL || 'http://127.0.0.1:2048';
  return {
    proxyUrl,
    proxyApiKey: process.env.PROXY_API_KEY || '',
    concurrency: parseInt(process.env.CONCURRENCY || '10'),
    imageModel: process.env.IMAGE_MODEL || 'gemini-2.0-flash-exp',
    videoModel: process.env.VIDEO_MODEL || 'veo-2.0-generate-001',
    chatModel: process.env.CHAT_MODEL || 'gemini-2.5-flash',
    maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
    outputDir: process.env.OUTPUT_DIR || './output',
  };
}

function parseArgs(args) {
  const parsed = { command: args[0], flags: {} };
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      parsed.flags[key] = val;
    } else {
      parsed.flags.positional = parsed.flags.positional || [];
      parsed.flags.positional.push(args[i]);
    }
  }
  return parsed;
}

async function cmdGenerate(flags) {
  const config = loadConfig();
  const type = flags.type || 'image';
  const promptsFile = flags.file || flags.prompts || process.env.PROMPTS_FILE || './prompts.csv';
  const refImage = flags.ref || null;

  logger.info(`Proxy: ${config.proxyUrl}`);

  const client = new StudioProxyClient(logger, config.proxyUrl);
  const health = await client.healthCheck();
  if (!health.ok) {
    logger.error(`AIStudio2API not reachable at ${config.proxyUrl}`);
    logger.error(`Start AIStudio2API first. See SETUP-PROXY.md`);
    process.exit(1);
  }
  logger.info('AIStudio2API: connected');

  if (!fs.existsSync(promptsFile)) {
    logger.error(`Prompts file not found: ${promptsFile}`);
    logger.info('Create a prompts.csv with format: id,prompt');
    process.exit(1);
  }

  const gen = new BatchGenerator(config, logger);
  const prompts = gen.loadPrompts(promptsFile);

  if (prompts.length === 0) {
    logger.error('No prompts found in file');
    process.exit(1);
  }

  logger.info(`${prompts.length} prompts, ${config.concurrency} workers, type=${type}`);

  process.on('SIGINT', () => { gen.abort(); });

  let results;
  if (type === 'video') {
    results = await gen.generateVideos(prompts, {
      model: flags.model,
      timeout: flags.timeout ? parseInt(flags.timeout) : undefined,
      temperature: flags.temperature ? parseFloat(flags.temperature) : undefined,
    });
  } else if (refImage) {
    results = await gen.generateImagesWithRef(prompts, refImage, {
      model: flags.model,
      timeout: flags.timeout ? parseInt(flags.timeout) : undefined,
    });
  } else {
    results = await gen.generateImages(prompts, {
      model: flags.model,
      timeout: flags.timeout ? parseInt(flags.timeout) : undefined,
      temperature: flags.temperature ? parseFloat(flags.temperature) : undefined,
    });
  }

  logger.info(`\nResults: ${results.success} ok, ${results.failed} fail`);
  process.exit(results.failed > 0 ? 1 : 0);
}

async function cmdStatus() {
  const config = loadConfig();
  logger.info('=== GG-API Status ===');
  logger.info(`Proxy: ${config.proxyUrl}`);
  logger.info(`Concurrency: ${config.concurrency}`);
  logger.info(`Image Model: ${config.imageModel}`);
  logger.info(`Video Model: ${config.videoModel}`);
  logger.info(`Output: ${config.outputDir}`);

  const client = new StudioProxyClient(logger, config.proxyUrl);
  const health = await client.healthCheck();
  logger.info(`AIStudio2API: ${health.ok ? 'ONLINE' : 'OFFLINE - ' + (health.error || '')}`);

  const outputDir = config.outputDir;
  if (fs.existsSync(outputDir)) {
    const imgDir = path.join(outputDir, 'images');
    const vidDir = path.join(outputDir, 'videos');
    const imgCount = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).length : 0;
    const vidCount = fs.existsSync(vidDir) ? fs.readdirSync(vidDir).length : 0;
    logger.info(`Generated: ${imgCount} images, ${vidCount} videos`);
  }
}

function cmdSetup() {
  const envExample = path.join(process.cwd(), '.env.example');
  const envFile = path.join(process.cwd(), '.env');

  if (fs.existsSync(envFile)) {
    logger.info('.env already exists');
  } else if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    logger.info('Created .env from .env.example');
  } else {
    logger.error('.env.example not found');
  }

  const outputDir = process.env.OUTPUT_DIR || './output';
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'videos'), { recursive: true });
  logger.info(`Output dirs: ${outputDir}/`);

  if (!fs.existsSync('./prompts.csv')) {
    fs.writeFileSync('./prompts.csv', 'id,prompt\n1,"A beautiful sunset over the ocean"\n2,"A cute cat wearing a hat"\n3,"A futuristic city at night"\n');
    logger.info('Created example prompts.csv');
  }

  logger.info('\nNext steps:');
  logger.info('1. Download & run AIStudio2API (see SETUP-PROXY.md)');
  logger.info('2. Edit .env with your PROXY_URL');
  logger.info('3. npm run gen:images');
}

function showHelp() {
  console.log(`
GG-API - Batch Image/Video Generator via AIStudio2API
No API keys needed. No rate limits. ~100K images/day with 2 Google accounts.

Usage:
  node src/cli.js <command> [options]

Commands:
  generate    Generate images or videos from prompts file
  status      Show config and AIStudio2API connection status
  setup       Initialize project (create .env, output dirs)

Generate Options:
  --type <image|video>    Generation type (default: image)
  --file <path>           Prompts file (CSV or JSON)
  --model <model>         Override model name
  --ref <path>            Reference image for generation
  --timeout <ms>          Request timeout
  --temperature <float>   Generation temperature

npm Scripts:
  npm run gen:images      Generate images from prompts.csv
  npm run gen:videos      Generate videos from prompts.csv
  npm run status          Show status
  npm run setup           Initialize project

Examples:
  node src/cli.js generate --type image --file prompts.csv
  node src/cli.js generate --type video --file video-prompts.json
  node src/cli.js generate --ref reference.png --file prompts.csv

Prerequisites:
  AIStudio2API running locally (see SETUP-PROXY.md)
`);
}

const args = process.argv.slice(2);
const { command, flags } = parseArgs(args);

switch (command) {
  case 'generate':
    cmdGenerate(flags);
    break;
  case 'status':
    cmdStatus();
    break;
  case 'setup':
    cmdSetup();
    break;
  default:
    showHelp();
}
