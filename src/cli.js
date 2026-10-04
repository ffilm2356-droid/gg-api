#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import BatchGenerator from './batch-generator.js';
import Logger from './logger.js';

const logger = new Logger(process.env.LOG_LEVEL || 'info');

function loadConfig() {
  const keys = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    logger.error('No API keys configured. Set GEMINI_API_KEYS in .env');
    process.exit(1);
  }

  return {
    apiKeys: keys,
    imageModel: process.env.IMAGE_MODEL || 'gemini-2.0-flash-exp',
    videoModel: process.env.VIDEO_MODEL || 'veo-2.0-generate-001',
    chatModel: process.env.CHAT_MODEL || 'gemini-2.5-flash',
    concurrencyPerKey: parseInt(process.env.CONCURRENCY_PER_KEY || '2'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
    rateLimitIntervalMs: parseInt(process.env.RATE_LIMIT_INTERVAL_MS || '4200'),
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

  logger.info(`Loaded ${prompts.length} prompts from ${promptsFile}`);
  logger.info(`Keys: ${config.apiKeys.length}, Concurrency: ${gen.concurrency}, Type: ${type}`);

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

  logger.info(`\nResults: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped`);
  process.exit(results.failed > 0 ? 1 : 0);
}

function cmdStatus() {
  const config = loadConfig();
  logger.info('=== GG-API Status ===');
  logger.info(`API Keys: ${config.apiKeys.length}`);
  logger.info(`Image Model: ${config.imageModel}`);
  logger.info(`Video Model: ${config.videoModel}`);
  logger.info(`Concurrency: ${config.apiKeys.length * config.concurrencyPerKey} (${config.apiKeys.length} keys × ${config.concurrencyPerKey})`);
  logger.info(`Rate Limit Interval: ${config.rateLimitIntervalMs}ms`);
  logger.info(`Output Dir: ${config.outputDir}`);

  const outputDir = config.outputDir;
  if (fs.existsSync(outputDir)) {
    const imgDir = path.join(outputDir, 'images');
    const vidDir = path.join(outputDir, 'videos');
    const imgCount = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).length : 0;
    const vidCount = fs.existsSync(vidDir) ? fs.readdirSync(vidDir).length : 0;
    logger.info(`Generated: ${imgCount} images, ${vidCount} videos`);
  }

  const est = config.apiKeys.length * (60000 / config.rateLimitIntervalMs) * 60 * 24;
  logger.info(`\nEstimated daily capacity: ~${Math.floor(est).toLocaleString()} images`);
}

function cmdSetup() {
  const envExample = path.join(process.cwd(), '.env.example');
  const envFile = path.join(process.cwd(), '.env');

  if (fs.existsSync(envFile)) {
    logger.info('.env already exists');
  } else if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    logger.info('Created .env from .env.example');
    logger.info('Edit .env and add your GEMINI_API_KEYS');
  } else {
    logger.error('.env.example not found');
  }

  const outputDir = process.env.OUTPUT_DIR || './output';
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'videos'), { recursive: true });
  logger.info(`Output directories created: ${outputDir}/`);

  if (!fs.existsSync('./prompts.csv')) {
    fs.writeFileSync('./prompts.csv', 'id,prompt\n1,"A beautiful sunset over the ocean"\n2,"A cute cat wearing a hat"\n3,"A futuristic city at night"\n');
    logger.info('Created example prompts.csv');
  }
}

function showHelp() {
  console.log(`
GG-API - High-Performance Batch Image/Video Generator

Usage:
  node src/cli.js <command> [options]

Commands:
  generate    Generate images or videos from prompts file
  status      Show configuration and stats
  setup       Initialize project (create .env, dirs)

Generate Options:
  --type <image|video>    Generation type (default: image)
  --file <path>           Prompts file path (CSV or JSON)
  --model <model>         Override model name
  --ref <path>            Reference image for image generation
  --timeout <ms>          Request timeout in ms
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
