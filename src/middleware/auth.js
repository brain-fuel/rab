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

// src/middleware/errorHandler.js - Error Handling Middleware
import { logger } from '../utils/logger.js';

export const errorHandler = (error, req, res, next) => {
  // Log the error with request context
  logger.error('💥 Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    params: req.params,
    query: req.query
  });
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      message: error.message,
      details: isDevelopment ? error.details : undefined,
      timestamp: new Date().toISOString()
    });
  }
  
  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      timestamp: new Date().toISOString()
    });
  }
  
  if (error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service unavailable',
      message: 'Cannot connect to RabbitMQ cluster',
      timestamp: new Date().toISOString()
    });
  }
  
  if (error.code === 'ENOTFOUND' || error.code === 'EHOSTUNREACH') {
    return res.status(503).json({
      error: 'Network error',
      message: 'Cannot reach target host',
      timestamp: new Date().toISOString()
    });
  }
  
  // Generic error response
  const statusCode = error.statusCode || error.status || 500;
  
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : 'Request failed',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    ...(isDevelopment && { 
      stack: error.stack,
      details: error.details 
    }),
    timestamp: new Date().toISOString()
  });
};

// Handle async errors
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// src/middleware/validation.js - Request Validation Middleware
import { validationResult } from 'express-validator';
import { logger } from '../utils/logger.js';

export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('📋 Request validation failed', {
      url: req.url,
      method: req.method,
      ip: req.ip,
      errors: errors.array(),
      body: req.body,
      params: req.params,
      query: req.query
    });
    
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Request contains invalid data',
      details: errors.array().map(err => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value
      })),
      timestamp: new Date().toISOString()
    });
  }
  
  next();
};

// src/middleware/requestLogger.js - Request Logging Middleware
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

// src/middleware/security.js - Security Middleware
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

// src/middleware/cors.js - CORS Configuration
export const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'http://localhost:3000', // Common React dev port
      'http://localhost:5174', // Alternative Vite port
    ];
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('🚫 CORS blocked request', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key'
  ],
  maxAge: 86400 // 24 hours
};
