import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/** Global error handler middleware */
export function errorHandler(
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode || 500;

  logger.error({
    err,
    statusCode,
    message: err.message,
    stack: err.stack,
  }, 'Request error');

  // Only expose error details in development — never in production or staging
  const isDev = process.env.NODE_ENV === 'development';
  res.status(statusCode).json({
    error: {
      message: statusCode === 500
        ? 'Internal server error'
        : (isDev ? err.message : 'Request error'),
      ...(isDev && { stack: err.stack }),
    },
  });
}

/** Request logger middleware */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
    }, `${req.method} ${req.url}`);
  });

  next();
}
