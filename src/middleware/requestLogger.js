import { logger, apiLogger } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log incoming request
  apiLogger.request(req);
  
  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - startTime;
    apiLogger.response(req, res, duration);
    return originalJson.call(this, data);
  };
  
  // Handle errors
  res.on('error', (error) => {
    apiLogger.error(req, error);
  });
  
  next();
};


