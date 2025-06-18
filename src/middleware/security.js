import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';

// Rate limiting for API endpoints
export const createRateLimit = (windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests') => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'Rate limit exceeded',
      message,
      retryAfter: Math.ceil(windowMs / 1000),
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('🚦 Rate limit exceeded', {
        ip: req.ip,
        url: req.url,
        userAgent: req.get('User-Agent')
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message,
        retryAfter: Math.ceil(windowMs / 1000),
        timestamp: new Date().toISOString()
      });
    }
  });
};

// Strict rate limiting for sensitive operations
export const strictRateLimit = createRateLimit(
  5 * 60 * 1000, // 5 minutes
  5, // 5 requests max
  'Too many sensitive operations - please wait'
);

// Standard rate limiting for general API
export const standardRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes  
  100, // 100 requests max
  'Too many API requests'
);

// IP whitelist middleware (optional)
export const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (allowedIPs.length === 0) {
      return next(); // No whitelist configured
    }
    
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (!allowedIPs.includes(clientIP)) {
      logger.warn('🚫 IP not in whitelist', {
        ip: clientIP,
        url: req.url,
        allowedIPs
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address is not authorized',
        timestamp: new Date().toISOString()
      });
    }
    
    next();
  };
};

// Request timeout middleware
export const timeout = (ms = 30000) => {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('⏱️ Request timeout', {
          url: req.url,
          method: req.method,
          ip: req.ip,
          timeout: ms
        });
        
        res.status(408).json({
          error: 'Request timeout',
          message: `Request took longer than ${ms}ms to complete`,
          timestamp: new Date().toISOString()
        });
      }
    }, ms);
    
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    
    next();
  };
};

