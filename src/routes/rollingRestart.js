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

