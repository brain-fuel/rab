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


