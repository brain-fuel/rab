// src/middleware/auth.js - Authentication Middleware
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const expectedApiKey = config.getEnvironment().apiKey;
  
  // Log the attempt
  logger.info('🔑 API key validation attempt', {
    endpoint: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    hasApiKey: !!apiKey,
    hasExpectedKey: !!expectedApiKey
  });
  
  if (!expectedApiKey) {
    // If no API key is configured, skip validation but log warning
    logger.warn('⚠️ No API key configured - authentication bypassed', {
      endpoint: req.path,
      ip: req.ip
    });
    return next();
  }
  
  if (!apiKey) {
    logger.warn('🔒 API key missing', {
      endpoint: req.path,
      method: req.method,
      ip: req.ip
    });
    
    return res.status(401).json({ 
      error: 'API key required',
      message: 'Provide API key in X-API-Key header or apiKey query parameter',
      timestamp: new Date().toISOString()
    });
  }
  
  if (apiKey !== expectedApiKey) {
    logger.warn('🔒 Invalid API key', {
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      providedKey: apiKey.substring(0, 8) + '...' // Log partial key for debugging
    });
    
    return res.status(401).json({ 
      error: 'Invalid API key',
      message: 'The provided API key is not valid',
      timestamp: new Date().toISOString()
    });
  }
  
  logger.info('✅ API key validation successful', {
    endpoint: req.path,
    method: req.method,
    ip: req.ip
  });
  
  next();
};

export const requireAuth = (req, res, next) => {
  // Placeholder for future authentication requirements
  // Could implement JWT, session-based auth, etc.
  next();
};

export const logSecurityEvent = (eventType, details) => {
  logger.warn('🛡️ Security event', {
    event: eventType,
    timestamp: new Date().toISOString(),
    ...details
  });
};

