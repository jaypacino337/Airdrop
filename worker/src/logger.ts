type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER.info;

export function setLogLevel(level: Level): void {
  threshold = ORDER[level];
}

function emit(level: Level, message: string, meta?: unknown): void {
  if (ORDER[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg: message,
    ...(meta !== undefined ? { meta: serialise(meta) } : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

/** JSON.stringify blows up on bigint, and Errors serialise to `{}`. */
export function serialise(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      return v;
    }),
  );
}

export const log = {
  debug: (m: string, meta?: unknown) => emit('debug', m, meta),
  info: (m: string, meta?: unknown) => emit('info', m, meta),
  warn: (m: string, meta?: unknown) => emit('warn', m, meta),
  error: (m: string, meta?: unknown) => emit('error', m, meta),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
