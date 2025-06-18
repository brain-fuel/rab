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

