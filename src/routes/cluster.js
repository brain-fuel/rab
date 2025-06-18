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
