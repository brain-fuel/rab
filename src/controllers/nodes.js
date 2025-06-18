import { rabbitmqService } from '../services/rabbitmq.js';
import { nodeService } from '../services/nodeService.js';
import { config } from '../config/index.js';
import { logger, apiLogger } from '../utils/logger.js';

export const getNode = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    // Get comprehensive node information
    const [health, systemStatus, connections] = await Promise.allSettled([
      rabbitmqService.checkNodeHealth(nodeId),
      nodeService.getNodeStatus(node),
      rabbitmqService.getConnectionCount(nodeId)
    ]);
    
    const response = {
      ...node,
      health: health.status === 'fulfilled' ? health.value : { error: health.reason?.message },
      systemStatus: systemStatus.status === 'fulfilled' ? systemStatus.value : { error: systemStatus.reason?.message },
      connectionCount: connections.status === 'fulfilled' ? connections.value : 0,
      managementUrl: config.getNodeManagementUrl(node),
      connectionString: config.getNodeConnectionString(node),
      timestamp: new Date().toISOString()
    };
    
    apiLogger.response(req, res, 0);
    res.json(response);
    
  } catch (error) {
    logger.error(`Failed to get node ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to get node information',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};

export const setMaintenanceMode = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const { maintenance, reason = '' } = req.body;
    
    if (typeof maintenance !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid maintenance value',
        message: 'maintenance must be a boolean (true/false)',
        timestamp: new Date().toISOString()
      });
    }
    
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await rabbitmqService.setMaintenanceMode(nodeId, maintenance, reason);
    
    logger.info(`🔧 ${node.name} maintenance mode: ${maintenance ? 'ON' : 'OFF'}`, {
      reason,
      initiator: req.ip
    });
    
    apiLogger.response(req, res, 0);
    
    res.json({
      success: true,
      nodeId,
      nodeName: node.name,
      hostIp: node.hostIp,
      maintenance,
      reason,
      ...result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Failed to set maintenance mode for ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to set maintenance mode',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};

export const getNodeConnections = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    const connections = await rabbitmqService.getConnections(nodeId);
    
    const response = {
      nodeId,
      nodeName: node.name,
      hostIp: node.hostIp,
      connectionCount: connections.length,
      connections: connections.map(conn => ({
        name: conn.name,
        user: conn.user,
        vhost: conn.vhost,
        state: conn.state,
        channels: conn.channels,
        host: conn.host,
        port: conn.port,
        protocol: conn.protocol,
        clientProperties: conn.client_properties
      })),
      summary: {
        byState: connections.reduce((acc, conn) => {
          acc[conn.state] = (acc[conn.state] || 0) + 1;
          return acc;
        }, {}),
        byUser: connections.reduce((acc, conn) => {
          acc[conn.user] = (acc[conn.user] || 0) + 1;
          return acc;
        }, {})
      },
      timestamp: new Date().toISOString()
    };
    
    apiLogger.response(req, res, 0);
    res.json(response);
    
  } catch (error) {
    logger.error(`Failed to get connections for ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to get node connections',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};

export const restartNode = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const { reason = 'Manual restart via API' } = req.body;
    const initiator = req.ip || 'unknown';
    
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.info(`🔄 Individual node restart requested for ${node.name}`, {
      reason,
      initiator,
      hostIp: node.hostIp
    });
    
    const startTime = Date.now();
    
    // Restart the node
    await nodeService.restartNode(node);
    
    const duration = Date.now() - startTime;
    
    logger.info(`✅ Node restart completed for ${node.name}`, {
      duration: `${Math.round(duration / 1000)}s`,
      reason,
      initiator
    });
    
    apiLogger.response(req, res, duration);
    
    res.json({
      success: true,
      nodeId,
      nodeName: node.name,
      hostIp: node.hostIp,
      message: 'Node restart completed successfully',
      reason,
      initiator,
      duration: `${Math.round(duration / 1000)}s`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Failed to restart ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to restart node',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};

export const stopNode = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const { reason = 'Manual stop via API' } = req.body;
    const initiator = req.ip || 'unknown';
    
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.info(`🛑 Node stop requested for ${node.name}`, {
      reason,
      initiator,
      hostIp: node.hostIp
    });
    
    await nodeService.stopNode(node);
    
    logger.info(`✅ Node stopped: ${node.name}`, { reason, initiator });
    
    apiLogger.response(req, res, 0);
    
    res.json({
      success: true,
      nodeId,
      nodeName: node.name,
      hostIp: node.hostIp,
      message: 'Node stopped successfully',
      reason,
      initiator,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Failed to stop ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to stop node',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};

export const startNode = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const { reason = 'Manual start via API' } = req.body;
    const initiator = req.ip || 'unknown';
    
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.info(`▶️ Node start requested for ${node.name}`, {
      reason,
      initiator,
      hostIp: node.hostIp
    });
    
    await nodeService.startNode(node);
    
    logger.info(`✅ Node started: ${node.name}`, { reason, initiator });
    
    apiLogger.response(req, res, 0);
    
    res.json({
      success: true,
      nodeId,
      nodeName: node.name,
      hostIp: node.hostIp,
      message: 'Node started successfully',
      reason,
      initiator,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`Failed to start ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to start node',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};

export const getNodeSystemInfo = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { nodeId } = req.params;
    const node = config.getNodeById(nodeId) || config.getNodeByName(nodeId);
    
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found in topology',
        nodeId,
        timestamp: new Date().toISOString()
      });
    }
    
    const systemInfo = await nodeService.getSystemInfo(node);
    
    apiLogger.response(req, res, 0);
    res.json(systemInfo);
    
  } catch (error) {
    logger.error(`Failed to get system info for ${req.params.nodeId}:`, error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to get system information',
      message: error.message,
      nodeId: req.params.nodeId,
      timestamp: new Date().toISOString()
    });
  }
};
