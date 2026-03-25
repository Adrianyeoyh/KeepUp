import pino from 'pino';
import { config } from './config.js';

// TODO: Replace 'publisher-template' with your provider name
//       e.g., 'publisher-linear', 'publisher-zendesk'

export const logger = pino({
  name: 'publisher-template',
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: config.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
