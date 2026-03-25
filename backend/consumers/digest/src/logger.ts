import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  name: 'consumer-digest',
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: config.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
