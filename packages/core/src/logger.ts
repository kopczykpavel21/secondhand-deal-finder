type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  data?: unknown;
}

const isDev = process.env.NODE_ENV !== 'production';

function log(level: LogLevel, msg: string, data?: unknown): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    data,
  };

  if (isDev) {
    const colours: Record<LogLevel, string> = {
      debug: '\x1b[90m',
      info: '\x1b[36m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    const reset = '\x1b[0m';
    console[level === 'debug' ? 'log' : level](
      `${colours[level]}[${entry.ts}] [${level.toUpperCase()}] ${msg}${reset}`,
      data ?? '',
    );
  } else {
    // Production: emit structured JSON for log aggregators (e.g. Datadog, Loki)
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
};
