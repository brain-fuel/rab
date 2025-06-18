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

