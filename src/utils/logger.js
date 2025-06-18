import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.resolve(__dirname, '../../logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels with colors
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

winston.addColors(logColors);

// Production log format (JSON for parsing)
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Development console format (human readable)
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      // Pretty print objects, simple display for primitives
      const metaStr = Object.entries(meta)
        .map(([key, value]) => {
          if (typeof value === 'object') {
            return `${key}=${JSON.stringify(value)}`;
          }
          return `${key}=${value}`;
        })
        .join(' ');
      msg += ` ${metaStr}`;
    }
    
    return msg;
  })
);

// Determine if we're in production
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Create the logger
export const logger = winston.createLogger({
  level: logLevel,
  levels: logLevels,
  format: isProduction ? productionFormat : developmentFormat,
  transports: [
    // Console logging - always enabled
    new winston.transports.Console({
      format: isProduction ? productionFormat : developmentFormat
    }),
    
    // Error log file - errors only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: productionFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Combined log file - all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: productionFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true
    }),
    
    // Rolling restart specific log file
    new winston.transports.File({
      filename: path.join(logsDir, 'rolling-restart.log'),
      format: productionFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      tailable: true,
      // Only log rolling restart related entries
      level: 'info'
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: productionFormat
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: productionFormat
    })
  ]
});

// Add helper methods for specific logging scenarios
export const rollingRestartLogger = {
  start: (details) => {
    logger.info('🚀 Rolling restart started', {
      event: 'rolling_restart_start',
      cluster: details.clusterName,
      nodeCount: details.nodeCount,
      reason: details.reason,
      initiator: details.initiator
    });
  },
  
  nodeStart: (nodeName, order) => {
    logger.info(`🔄 Starting restart for node ${order}`, {
      event: 'node_restart_start',
      node: nodeName,
      order: order
    });
  },
  
  nodeComplete: (nodeName, order, duration) => {
    logger.info(`✅ Node restart completed`, {
      event: 'node_restart_complete',
      node: nodeName,
      order: order,
      duration: duration
    });
  },
  
  nodeError: (nodeName, order, error) => {
    logger.error(`❌ Node restart failed`, {
      event: 'node_restart_error',
      node: nodeName,
      order: order,
      error: error.message,
      stack: error.stack
    });
  },
  
  complete: (details) => {
    logger.info('🎉 Rolling restart completed successfully', {
      event: 'rolling_restart_complete',
      cluster: details.clusterName,
      totalDuration: details.totalDuration,
      nodesRestarted: details.nodesRestarted
    });
  },
  
  failed: (details) => {
    logger.error('💥 Rolling restart failed', {
      event: 'rolling_restart_failed',
      cluster: details.clusterName,
      failedNode: details.failedNode,
      error: details.error,
      nodesCompleted: details.nodesCompleted
    });
  },
  
  cancelled: (details) => {
    logger.warn('⚠️ Rolling restart cancelled', {
      event: 'rolling_restart_cancelled',
      cluster: details.clusterName,
      reason: details.reason,
      nodesCompleted: details.nodesCompleted
    });
  }
};

// Helper for API request logging
export const apiLogger = {
  request: (req) => {
    logger.http('📡 API Request', {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  },
  
  response: (req, res, duration) => {
    const level = res.statusCode >= 400 ? 'warn' : 'http';
    logger.log(level, '📤 API Response', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  },
  
  error: (req, error) => {
    logger.error('💥 API Error', {
      method: req.method,
      url: req.url,
      ip: req.ip,
      error: error.message,
      stack: error.stack
    });
  }
};

// Helper for RabbitMQ API logging
export const rabbitmqLogger = {
  apiCall: (method, endpoint, nodeId) => {
    logger.debug('🐰 RabbitMQ API Call', {
      method,
      endpoint,
      node: nodeId
    });
  },
  
  apiSuccess: (method, endpoint, nodeId, duration) => {
    logger.debug('✅ RabbitMQ API Success', {
      method,
      endpoint,
      node: nodeId,
      duration: `${duration}ms`
    });
  },
  
  apiError: (method, endpoint, nodeId, error) => {
    logger.error('❌ RabbitMQ API Error', {
      method,
      endpoint,
      node: nodeId,
      error: error.message
    });
  },
  
  healthCheck: (nodeId, healthy, details) => {
    const level = healthy ? 'debug' : 'warn';
    logger.log(level, `💓 Health Check: ${nodeId}`, {
      event: 'health_check',
      node: nodeId,
      healthy,
      ...details
    });
  },
  
  connectionDrain: (nodeId, connectionCount) => {
    logger.info(`💧 Draining connections: ${nodeId}`, {
      event: 'connection_drain',
      node: nodeId,
      connections: connectionCount
    });
  },
  
  maintenanceMode: (nodeId, enabled, reason) => {
    logger.info(`🔧 Maintenance mode ${enabled ? 'ON' : 'OFF'}: ${nodeId}`, {
      event: 'maintenance_mode',
      node: nodeId,
      enabled,
      reason
    });
  }
};

// Helper for SSH operations
export const sshLogger = {
  connect: (hostname) => {
    logger.info(`🔐 SSH connecting to ${hostname}`, {
      event: 'ssh_connect',
      host: hostname
    });
  },
  
  command: (hostname, command) => {
    logger.debug(`⚡ SSH command on ${hostname}`, {
      event: 'ssh_command',
      host: hostname,
      command: command
    });
  },
  
  success: (hostname, command, output) => {
    logger.debug(`✅ SSH success on ${hostname}`, {
      event: 'ssh_success',
      host: hostname,
      command: command,
      output: output.substring(0, 200) // Truncate long output
    });
  },
  
  error: (hostname, command, error) => {
    logger.error(`❌ SSH error on ${hostname}`, {
      event: 'ssh_error',
      host: hostname,
      command: command,
      error: error.message
    });
  }
};

// Log startup information
logger.info('📝 Logger initialized', {
  level: logLevel,
  environment: process.env.NODE_ENV || 'development',
  logsDirectory: logsDir
});

// Export default logger
export default logger;
