import { rabbitmqService } from '../services/rabbitmq.js';
import { nodeService } from '../services/nodeService.js';
import { config } from '../config/index.js';
import { logger, apiLogger } from '../utils/logger.js';

export const getClusterStatus = async (req, res) => {
  const startTime = Date.now();
  
  try {
    apiLogger.request(req);
    
    const topology = config.getTopology();
    const nodes = [];
    
    // Get comprehensive status for each node
    for (const topologyNode of topology.nodes) {
      try {
        // Get RabbitMQ health from management API
        const health = await rabbitmqService.checkNodeHealth(topologyNode.id);
        
        // Get system-level status from SSH
        let systemStatus = null;
        try {
          systemStatus = await nodeService.getNodeStatus(topologyNode);
        } catch (sshError) {
          logger.warn(`Could not get SSH status for ${topologyNode.name}:`, sshError.message);
        }
        
        // Combine topology, health, and system data
        const nodeStatus = {
          ...topologyNode,
          hostIp: topologyNode.hostIp,
          status: health.running ? 'running' : 'stopped',
          memory: `${Math.round((health.memoryUsed || 0) / (1024 * 1024))}MB`,
          memoryUsagePercent: health.memoryPercent || 0,
          disk: `${health.diskFreeGB || 0}GB`,
          diskFreeGB: health.diskFreeGB || 0,
          uptime: formatUptime(health.uptime),
          lastHealthCheck: new Date(health.lastCheck),
          connectionCount: 0, // Will be populated below
          canRestart: health.isHealthy,
          partitions: health.partitions || [],
          alarms: health.alarms || [],
          issues: health.issues || [],
          isHealthy: health.isHealthy,
          systemActive: systemStatus?.active || false
        };
        
        // Get connection count
        try {
          nodeStatus.connectionCount = await rabbitmqService.getConnectionCount(topologyNode.id);
        } catch (connError) {
          logger.warn(`Could not get connection count for ${topologyNode.name}:`, connError.message);
        }
        
        nodes.push(nodeStatus);
        
      } catch (error) {
        // If we can't get health data, mark as stopped with error
        logger.error(`Failed to get status for ${topologyNode.name}:`, error.message);
        
        nodes.push({
          ...topologyNode,
          hostIp: topologyNode.hostIp,
          status: 'stopped',
          memory: '0MB',
          memoryUsagePercent: 0,
          disk: '0GB',
          diskFreeGB: 0,
          uptime: '0m',
          lastHealthCheck: new Date(),
          connectionCount: 0,
          canRestart: false,
          partitions: [],
          alarms: [],
          issues: [`Health check failed: ${error.message}`],
          isHealthy: false,
          systemActive: false,
          error: error.message
        });
      }
    }
    
    // Get queues information
    let queues = [];
    try {
      const rabbitQueues = await rabbitmqService.getQueues();
      queues = rabbitQueues.map(q => ({
        name: q.name,
        vhost: q.vhost,
        messages: q.messages || 0,
        consumers: q.consumers || 0,
        state: (q.messages || 0) > 0 ? 'running' : 'idle',
        node: q.node,
        durable: q.durable || false,
        autoDelete: q.auto_delete || false
      }));
    } catch (error) {
      logger.warn('Could not fetch queues:', error.message);
    }
    
    const response = {
      cluster: {
        name: topology.clusterName,
        version: topology.version,
        nodes,
        queues,
        summary: {
          totalNodes: nodes.length,
          healthyNodes: nodes.filter(n => n.isHealthy).length,
          runningNodes: nodes.filter(n => n.status === 'running').length,
          totalQueues: queues.length,
          totalMessages: queues.reduce((sum, q) => sum + q.messages, 0),
          totalConnections: nodes.reduce((sum, n) => sum + n.connectionCount, 0)
        }
      },
      timestamp: new Date().toISOString()
    };
    
    const duration = Date.now() - startTime;
    apiLogger.response(req, res, duration);
    
    res.json(response);
    
  } catch (error) {
    logger.error('Failed to get cluster status:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({ 
      error: 'Failed to get cluster status',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const getClusterTopology = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const topology = config.getTopology();
    const environment = config.getEnvironment();
    
    const response = {
      ...topology,
      features: {
        rollingRestartEnabled: config.isRollingRestartEnabled(),
        requireAllNodesHealthy: config.requiresAllNodesHealthy(),
        allowRestartWithPartitions: config.allowsRestartWithPartitions(),
        sshConfigured: !!(environment.sshKeyPath || environment.sshPassword),
        apiKeyConfigured: !!environment.apiKey
      },
      managementUrls: config.getManagementUrls(),
      timestamp: new Date().toISOString()
    };
    
    apiLogger.response(req, res, 0);
    res.json(response);
    
  } catch (error) {
    logger.error('Failed to get topology:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({ 
      error: 'Failed to get topology',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const validateClusterHealth = async (req, res) => {
  const startTime = Date.now();
  
  try {
    apiLogger.request(req);
    
    const validation = await rabbitmqService.validateClusterHealth();
    
    // Add additional SSH connectivity check if requested
    const { checkSSH = false } = req.query;
    let sshResults = null;
    
    if (checkSSH) {
      try {
        sshResults = await nodeService.testSSHConnectivity();
        
        // Add SSH issues to validation
        const sshIssues = sshResults
          .filter(r => !r.connected)
          .map(r => `SSH failed to ${r.node}: ${r.error}`);
          
        if (sshIssues.length > 0) {
          validation.issues.push(...sshIssues);
          validation.healthy = false;
          validation.canStartRollingRestart = false;
        }
      } catch (sshError) {
        logger.warn('SSH connectivity check failed:', sshError.message);
        validation.issues.push(`SSH connectivity check failed: ${sshError.message}`);
      }
    }
    
    const response = {
      ...validation,
      sshConnectivity: sshResults,
      recommendations: generateHealthRecommendations(validation),
      timestamp: new Date().toISOString()
    };
    
    const duration = Date.now() - startTime;
    apiLogger.response(req, res, duration);
    
    // Return appropriate HTTP status
    const status = validation.healthy ? 200 : validation.healthyNodes > 0 ? 207 : 503;
    res.status(status).json(response);
    
  } catch (error) {
    logger.error('Failed to validate cluster health:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({ 
      error: 'Failed to validate cluster health',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const getClusterConnectivity = async (req, res) => {
  try {
    apiLogger.request(req);
    
    // Test both RabbitMQ API and SSH connectivity
    const [rabbitMQResults, sshResults] = await Promise.all([
      rabbitmqService.testConnectivity(),
      nodeService.testSSHConnectivity()
    ]);
    
    // Combine results
    const topology = config.getTopology();
    const combinedResults = topology.nodes.map(node => {
      const rabbitResult = rabbitMQResults.find(r => r.node === node.name) || {};
      const sshResult = sshResults.find(r => r.node === node.name) || {};
      
      return {
        node: node.name,
        hostIp: node.hostIp,
        managementPort: node.managementPort,
        sshPort: node.sshPort || 22,
        rabbitmq: {
          connected: rabbitResult.connected || false,
          duration: rabbitResult.duration || null,
          error: rabbitResult.error || null
        },
        ssh: {
          connected: sshResult.connected || false,
          duration: sshResult.duration || null,
          error: sshResult.error || null
        },
        overallHealthy: (rabbitResult.connected && sshResult.connected) || false
      };
    });
    
    const summary = {
      totalNodes: combinedResults.length,
      rabbitmqConnected: combinedResults.filter(r => r.rabbitmq.connected).length,
      sshConnected: combinedResults.filter(r => r.ssh.connected).length,
      fullyConnected: combinedResults.filter(r => r.overallHealthy).length
    };
    
    apiLogger.response(req, res, 0);
    
    res.json({
      connectivity: combinedResults,
      summary,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to test connectivity:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({ 
      error: 'Failed to test connectivity',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const reloadConfiguration = async (req, res) => {
  try {
    apiLogger.request(req);
    
    logger.info('🔄 Configuration reload requested');
    
    // Reload configuration
    config.reload();
    
    const summary = config.getSummary();
    
    logger.info('✅ Configuration reloaded successfully');
    
    apiLogger.response(req, res, 0);
    
    res.json({
      success: true,
      message: 'Configuration reloaded successfully',
      summary,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to reload configuration:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({ 
      error: 'Failed to reload configuration',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Helper functions
function formatUptime(uptimeMs) {
  if (!uptimeMs) return '0m';
  
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

function generateHealthRecommendations(validation) {
  const recommendations = [];
  
  if (validation.healthyNodes < validation.totalNodes) {
    recommendations.push('Investigate and fix unhealthy nodes before attempting rolling restart');
  }
  
  if (validation.issues.some(issue => issue.includes('partition'))) {
    recommendations.push('Resolve network partitions before proceeding - this is critical for cluster stability');
  }
  
  if (validation.issues.some(issue => issue.includes('alarm'))) {
    recommendations.push('Clear all critical alarms (memory, disk, file descriptors) before restart');
  }
  
  if (validation.issues.some(issue => issue.includes('SSH'))) {
    recommendations.push('Verify SSH connectivity and credentials for all nodes');
  }
  
  if (validation.canStartRollingRestart) {
    recommendations.push('Cluster is healthy and ready for rolling restart');
  }
  
  return recommendations;
}
