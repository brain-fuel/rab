// src/routes/cluster.js - Cluster Routes
import express from 'express';
import { 
  getClusterStatus, 
  getClusterTopology, 
  validateClusterHealth,
  getClusterConnectivity,
  reloadConfiguration
} from '../controllers/cluster.js';

const router = express.Router();

// Cluster status and information
router.get('/status', getClusterStatus);
router.get('/topology', getClusterTopology);
router.get('/health', validateClusterHealth);
router.get('/connectivity', getClusterConnectivity);

// Configuration management
router.post('/reload', reloadConfiguration);

export default router;

// src/routes/nodes.js - Node Management Routes
import express from 'express';
import { body, param } from 'express-validator';
import { validateRequest } from '../middleware/validation.js';
import { 
  getNode,
  setMaintenanceMode,
  getNodeConnections,
  restartNode,
  stopNode,
  startNode,
  getNodeSystemInfo
} from '../controllers/nodes.js';

const router = express.Router();

// Node information
router.get('/:nodeId', [
  param('nodeId').notEmpty().withMessage('Node ID is required')
], validateRequest, getNode);

router.get('/:nodeId/connections', [
  param('nodeId').notEmpty().withMessage('Node ID is required')
], validateRequest, getNodeConnections);

router.get('/:nodeId/system', [
  param('nodeId').notEmpty().withMessage('Node ID is required')
], validateRequest, getNodeSystemInfo);

// Node maintenance mode
router.put('/:nodeId/maintenance', [
  param('nodeId').notEmpty().withMessage('Node ID is required'),
  body('maintenance').isBoolean().withMessage('maintenance must be true or false'),
  body('reason').optional().isString().withMessage('reason must be a string')
], validateRequest, setMaintenanceMode);

// Node operations (require API key - applied in server.js)
router.post('/:nodeId/restart', [
  param('nodeId').notEmpty().withMessage('Node ID is required'),
  body('reason').optional().isString().withMessage('reason must be a string')
], validateRequest, restartNode);

router.post('/:nodeId/stop', [
  param('nodeId').notEmpty().withMessage('Node ID is required'),
  body('reason').optional().isString().withMessage('reason must be a string')
], validateRequest, stopNode);

router.post('/:nodeId/start', [
  param('nodeId').notEmpty().withMessage('Node ID is required'),
  body('reason').optional().isString().withMessage('reason must be a string')
], validateRequest, startNode);

export default router;

// src/routes/rolling-restart.js - Rolling Restart Routes
import express from 'express';
import { body, query } from 'express-validator';
import { validateRequest } from '../middleware/validation.js';
import {
  startRollingRestart,
  getRollingRestartStatus,
  cancelRollingRestart,
  getRollingRestartHistory,
  validateRollingRestart
} from '../controllers/rollingRestart.js';

const router = express.Router();

// Rolling restart operations (all require API key - applied in server.js)
router.post('/start', [
  body('dryRun').optional().isBoolean().withMessage('dryRun must be true or false'),
  body('force').optional().isBoolean().withMessage('force must be true or false'),
  body('reason').optional().isString().withMessage('reason must be a string'),
  body('skipValidation').optional().isBoolean().withMessage('skipValidation must be true or false')
], validateRequest, startRollingRestart);

router.get('/status', getRollingRestartStatus);

router.post('/cancel', [
  body('reason').optional().isString().withMessage('reason must be a string')
], validateRequest, cancelRollingRestart);

router.get('/history', [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100')
], validateRequest, getRollingRestartHistory);

router.post('/validate', validateRollingRestart);

export default router;

// src/routes/health.js - Health Check Routes  
import express from 'express';
import { query } from 'express-validator';
import { validateRequest } from '../middleware/validation.js';
import { getHealthCheck, getDetailedHealthCheck } from '../controllers/health.js';

const router = express.Router();

// Basic health check
router.get('/', getHealthCheck);

// Detailed health check with optional SSH testing
router.get('/detailed', [
  query('checkSSH').optional().isBoolean().withMessage('checkSSH must be true or false')
], validateRequest, getDetailedHealthCheck);

export default router;
