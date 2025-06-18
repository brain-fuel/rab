import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { validateApiKey } from './middleware/auth.js';
import clusterRoutes from './routes/cluster.js';
import nodeRoutes from './routes/nodes.js';
import healthRoutes from './routes/health.js';
import rollingRestartRoutes from './routes/rolling-restart.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Logging
app.use(morgan('combined', { 
  stream: { write: message => logger.info(message.trim()) }
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API key validation for sensitive operations
app.use('/api/rolling-restart', validateApiKey);
app.use('/api/nodes/*/restart', validateApiKey);
app.use('/api/nodes/*/stop', validateApiKey);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/cluster', clusterRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/rolling-restart', rollingRestartRoutes);

// Basic health check
app.get('/', (req, res) => {
  res.json({ 
    service: 'RabbitMQ Admin Backend',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 RabbitMQ Admin Backend running on port ${PORT}`);
  logger.info(`📊 Health check: http://localhost:${PORT}/`);
  logger.info(`🔌 API endpoints: http://localhost:${PORT}/api/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');  
  process.exit(0);
});

export default app;
