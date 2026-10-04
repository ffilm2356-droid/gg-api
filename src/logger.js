const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(level = 'info') {
    this.level = LEVELS[level] ?? 1;
    this.startTime = Date.now();
  }

  _ts() {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    return `[${new Date().toISOString().slice(11, 19)}|${elapsed}s]`;
  }

  debug(...args) { if (this.level <= 0) console.log(`${this._ts()} [DEBUG]`, ...args); }
  info(...args) { if (this.level <= 1) console.log(`${this._ts()} [INFO]`, ...args); }
  warn(...args) { if (this.level <= 2) console.warn(`${this._ts()} [WARN]`, ...args); }
  error(...args) { if (this.level <= 3) console.error(`${this._ts()} [ERROR]`, ...args); }

  progress(current, total, extra = '') {
    const pct = ((current / total) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(current / total * 30)).padEnd(30, '░');
    process.stdout.write(`\r${this._ts()} [${bar}] ${pct}% (${current}/${total}) ${extra}   `);
    if (current === total) process.stdout.write('\n');
  }
}

export default Logger;
