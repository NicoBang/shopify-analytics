// Structured logging utility for Edge Functions
export class Logger {
  private functionName: string;
  private testMode: boolean;

  constructor(functionName: string, testMode = false) {
    this.functionName = functionName;
    this.testMode = testMode;
  }

  private log(level: string, message: string, meta?: Record<string, any>) {
    const logEntry = {
      level,
      function: this.functionName,
      message,
      testMode: this.testMode,
      ...meta,
      timestamp: new Date().toISOString(),
    };

    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  info(message: string, meta?: Record<string, any>) {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.log('warn', message, meta);
  }

  error(message: string, error?: Error | unknown, meta?: Record<string, any>) {
    const errorMeta: Record<string, any> = { ...meta };

    if (error instanceof Error) {
      errorMeta.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (error) {
      errorMeta.error = String(error);
    }

    this.log('error', message, errorMeta);
  }

  debug(message: string, meta?: Record<string, any>) {
    if (this.testMode || Deno.env.get('DEBUG') === 'true') {
      this.log('debug', message, meta);
    }
  }

  metric(name: string, value: number, tags?: Record<string, string>) {
    this.log('metric', `Metric: ${name}`, {
      metric_name: name,
      value,
      tags,
    });
  }
}