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

