// src/controllers/health.js - Health Check Controller
import { rabbitmqService } from '../services/rabbitmq.js';
import { nodeService } from '../services/nodeService.js';
import { config } from '../config/index.js';
import { logger, apiLogger } from '../utils/logger.js';

export const getHealthCheck = async (req, res) => {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    res.json({
      status: 'healthy',
      service: 'RabbitMQ Admin Backend',
      version: '1.0.0',
      uptime: {
        seconds: Math.floor(uptime),
        formatted: formatUptime(uptime * 1000)
      },
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`
      },
      cluster: config.getTopology().clusterName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const getDetailedHealthCheck = async (req, res) => {
  const health = {
    service: 'healthy',
    configuration: 'healthy',
    rabbitmq: 'unknown',
    ssh: 'unknown',
    nodes: [],
    timestamp: new Date().toISOString()
  };
  
  let overall = 'healthy';
  
  try {
    // Check configuration
    const topology = config.getTopology();
    health.configuration = 'healthy';
    health.nodesConfigured = topology.nodes.length;
    
    // Check RabbitMQ API connectivity
    try {
      const connectivityResults = await rabbitmqService.testConnectivity();
      const connectedNodes = connectivityResults.filter(r => r.connected).length;
      
      if (connectedNodes === topology.nodes.length) {
        health.rabbitmq = 'healthy';
      } else if (connectedNodes > 0) {
        health.rabbitmq = 'degraded';
        overall = 'degraded';
      } else {
        health.rabbitmq = 'unhealthy';
        overall = 'degraded';
      }
      
      health.rabbitmqConnectivity = connectivityResults;
    } catch (error) {
      health.rabbitmq = 'unhealthy';
      health.rabbitmqError = error.message;
      overall = 'degraded';
    }
    
    // Check SSH connectivity
    try {
      const sshResults = await nodeService.testSSHConnectivity();
      const sshConnected = sshResults.filter(r => r.connected).length;
      
      if (sshConnected === topology.nodes.length) {
        health.ssh = 'healthy';
      } else if (sshConnected > 0) {
        health.ssh = 'degraded';
        overall = 'degraded';
      } else {
        health.ssh = 'unhealthy';
        overall = 'degraded';
      }
      
      health.sshConnectivity = sshResults;
    } catch (sshError) {
      health.ssh = 'unhealthy';
      health.sshError = sshError.message;
      overall = 'degraded';
    }
    
    // Check each node's health
    for (const node of topology.nodes) {
      try {
        const nodeHealth = await rabbitmqService.checkNodeHealth(node.id);
        health.nodes.push({
          id: node.id,
          name: node.name,
          hostIp: node.hostIp,
          status: nodeHealth.isHealthy ? 'healthy' : 'unhealthy',
          running: nodeHealth.running,
          partitions: nodeHealth.partitions?.length || 0,
          alarms: nodeHealth.alarms?.length || 0,
          issues: nodeHealth.issues || []
        });
        
        if (!nodeHealth.isHealthy) {
          overall = 'degraded';
        }
      } catch (error) {
        health.nodes.push({
          id: node.id,
          name: node.name,
          hostIp: node.hostIp,
          status: 'unhealthy',
          error: error.message
        });
        overall = 'degraded';
      }
    }
    
  } catch (error) {
    overall = 'unhealthy';
    health.configurationError = error.message;
  }
  
  health.overall = overall;
  health.summary = {
    total: health.nodes.length,
    healthy: health.nodes.filter(n => n.status === 'healthy').length,
    unhealthy: health.nodes.filter(n => n.status === 'unhealthy').length
  };
  
  const status = overall === 'healthy' ? 200 : overall === 'degraded' ? 207 : 500;
  res.status(status).json(health);
};

function formatUptime(uptimeMs) {
  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else {
    return `${minutes}m`;
  }
}

