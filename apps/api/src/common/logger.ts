import { ConsoleLogger, type LoggerService } from '@nestjs/common';

/** JSON logs in production (CloudWatch/Loki friendly), pretty logs locally. */
export function createLogger(service: string): LoggerService {
  const json = process.env.LOG_FORMAT ? process.env.LOG_FORMAT === 'json' : process.env.NODE_ENV === 'production';
  return new ConsoleLogger({ json, prefix: `hookrelay-${service}`, logLevels: process.env.LOG_DEBUG === 'true' ? undefined : ['log', 'warn', 'error', 'fatal'] });
}
