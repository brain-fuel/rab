import axios from 'axios';
import { logger, rabbitmqLogger } from '../utils/logger.js';
import { config } from '../config/index.js';

class RabbitMQService {
  constructor() {
    this.auth = {
      username: config.getEnvironment().rabbitMQUser,
      password: config.getEnvironment().rabbitMQPassword
    };
    this.timeout = config.getEnvironment().apiTimeout;
  }

  async makeRequest(method, endpoint, data = null, nodeOverride = null) {
    const startTime = Date.now();
    let targetUrl;
    
    if (nodeOverride) {
      // Use specific node's management API
      const node = typeof nodeOverride === 'string' 
        ? config.getNodeById(nodeOverride) || config.getNodeByName(nodeOverride)
        : nodeOverride;
      
      if (!node) {
        throw new Error(`Node not found: ${nodeOverride}`);
      }
      
      targetUrl = `${config.getNodeManagementUrl(node)}${endpoint}`;
    } else {
      // Use default management API base
      targetUrl = `${config.getEnvironment().managementAPIBase}${endpoint}`;
    }

    rabbitmqLogger.apiCall(method, endpoint, nodeOverride?.name || nodeOverride);

    try {
      const response = await axios({
        method,
        url: targetUrl,
        data,
        auth: this.auth,
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const duration = Date.now() - startTime;
      rabbitmqLogger.apiSuccess(method, endpoint, nodeOverride?.name || nodeOverride, duration);
      
      return response.data;
    } catch (error) {
      rabbitmqLogger.apiError(method, endpoint, nodeOverride?.name || nodeOverride, error);
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to RabbitMQ management API at ${targetUrl}`);
      } else if (error.response?.status === 401) {
        throw new Error('Authentication failed - check RABBITMQ_ADMIN_USER and RABBITMQ_ADMIN_PASSWORD');
      } else if (error.response?.status === 404) {
        throw new Error(`RabbitMQ API endpoint not found: ${endpoint}`);
      } else {
        throw new Error(`RabbitMQ API call failed: ${error.message}`);
      }
    }
  }

  // Cluster operations
  async getClusterStatus() {
    try {
      return await this.makeRequest('GET', '/cluster-name');
    } catch (error) {
      logger.warn('Could not get cluster name, using topology name');
      return { name: config.getTopology().clusterName };
    }
  }

  async getNodes() {
    return await this.makeRequest('GET', '/nodes');
  }

  async getNode(nodeId) {
    return await this.makeRequest('GET', `/nodes/${encodeURIComponent(nodeId)}`);
  }

  // Health checks - comprehensive node health validation
  async checkNodeHealth(nodeId) {
    const startTime = Date.now();
    
    try {
      const node = await this.getNode(nodeId);
      const alarms = await this.getAlarms();
      
      // Calculate health metrics
      const memoryPercent = node.mem_limit > 0 
        ? Math.round((node.mem_used / node.mem_limit) * 100) 
        : 0;
      
      const diskFreeGB = Math.round(node.disk_free / (1024 * 1024 * 1024));
      
      const fdPercent = node.fd_total > 0 
        ? Math.round((node.fd_used / node.fd_total) * 100) 
        : 0;

      const socketsPercent = node.sockets_total > 0 
        ? Math.round((node.sockets_used / node.sockets_total) * 100) 
        : 0;

      // Determine overall health
      const nodeAlarms = alarms.filter(alarm => alarm.node === nodeId);
      const hasPartitions = node.partitions && node.partitions.length > 0;
      const memoryHigh = memoryPercent > 90;
      const diskLow = diskFreeGB < 1;
      const fdHigh = fdPercent > 95;
      
      const isHealthy = node.running && 
                       !hasPartitions && 
                       nodeAlarms.length === 0 && 
                       !memoryHigh && 
                       !diskLow && 
                       !fdHigh;

      const healthData = {
        nodeId,
        running: node.running,
        memoryUsed: node.mem_used,
        memoryLimit: node.mem_limit,
        memoryPercent,
        diskFree: node.disk_free,
        diskFreeGB,
        diskFreeLimit: node.disk_free_limit,
        fdUsed: node.fd_used,
        fdTotal: node.fd_total,
        fdPercent,
        socketsUsed: node.sockets_used,
        socketsTotal: node.sockets_total,
        socketsPercent,
        uptime: node.uptime,
        partitions: node.partitions || [],
        alarms: nodeAlarms,
        isHealthy,
        lastCheck: new Date().toISOString(),
        issues: []
      };

      // Collect health issues
      if (!node.running) healthData.issues.push('Node not running');
      if (hasPartitions) healthData.issues.push(`Partitioned from: ${node.partitions.join(', ')}`);
      if (nodeAlarms.length > 0) healthData.issues.push(`Alarms: ${nodeAlarms.map(a => a.alarm).join(', ')}`);
      if (memoryHigh) healthData.issues.push(`High memory usage: ${memoryPercent}%`);
      if (diskLow) healthData.issues.push(`Low disk space: ${diskFreeGB}GB`);
      if (fdHigh) healthData.issues.push(`High file descriptor usage: ${fdPercent}%`);

      rabbitmqLogger.healthCheck(nodeId, isHealthy, {
        memory: memoryPercent,
        disk: diskFreeGB,
        partitions: node.partitions?.length || 0,
        alarms: nodeAlarms.length
      });

      return healthData;
      
    } catch (error) {
      const healthData = {
        nodeId,
        running: false,
        isHealthy: false,
        error: error.message,
        lastCheck: new Date().toISOString(),
        issues: [`Health check failed: ${error.message}`]
      };
      
      rabbitmqLogger.healthCheck(nodeId, false, { error: error.message });
      return healthData;
    }
  }

  // Connection operations
  async getConnections(nodeId = null) {
    const connections = await this.makeRequest('GET', '/connections');
    return nodeId ? connections.filter(conn => conn.node === nodeId) : connections;
  }

  async getConnectionCount(nodeId) {
    try {
      const connections = await this.getConnections(nodeId);
      const activeConnections = connections.filter(conn => conn.state === 'running');
      
      rabbitmqLogger.connectionDrain(nodeId, activeConnections.length);
      return activeConnections.length;
    } catch (error) {
      logger.warn(`Could not get connection count for ${nodeId}:`, error.message);
      return 0;
    }
  }

  async closeConnection(connectionName) {
    return await this.makeRequest('DELETE', `/connections/${encodeURIComponent(connectionName)}`);
  }

  async forceCloseNodeConnections(nodeId, maxToClose = 10) {
    try {
      const connections = await this.getConnections(nodeId);
      const activeConnections = connections.filter(conn => conn.state === 'running');
      
      if (activeConnections.length === 0) {
        return { closed: 0, remaining: 0 };
      }

      const toClose = activeConnections.slice(0, maxToClose);
      let closed = 0;
      
      for (const conn of toClose) {
        try {
          await this.closeConnection(conn.name);
          closed++;
          logger.info(`🔌 Force closed connection: ${conn.name}`);
        } catch (error) {
          logger.warn(`Failed to close connection ${conn.name}:`, error.message);
        }
      }
      
      const remaining = Math.max(0, activeConnections.length - closed);
      
      logger.info(`🔌 Force closed ${closed} connections on ${nodeId}, ${remaining} remaining`);
      
      return { closed, remaining };
    } catch (error) {
      logger.error(`Failed to force close connections on ${nodeId}:`, error);
      throw error;
    }
  }

  // Queue operations
  async getQueues() {
    return await this.makeRequest('GET', '/queues');
  }

  async getQueuesByNode(nodeId) {
    const queues = await this.getQueues();
    return queues.filter(queue => queue.node === nodeId);
  }

  // Maintenance mode operations
  async setMaintenanceMode(nodeId, maintenance, reason = '') {
    const node = config.getNodeById(nodeId);
    if (!node) {
      throw new Error(`Node not found in topology: ${nodeId}`);
    }

    try {
      await this.makeRequest('PUT', `/nodes/${encodeURIComponent(nodeId)}/maintenance`, {
        maintenance,
        reason
      }, node);

      rabbitmqLogger.maintenanceMode(nodeId, maintenance, reason);
      
      return { 
        nodeId, 
        maintenance, 
        reason,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Some RabbitMQ versions may not support maintenance mode API
      logger.warn(`Maintenance mode API not available for ${nodeId}, continuing anyway`);
      return { 
        nodeId, 
        maintenance, 
        reason,
        timestamp: new Date().toISOString(),
        warning: 'Maintenance mode API not supported'
      };
    }
  }

  // Partition detection
  async getPartitions() {
    try {
      const nodes = await this.getNodes();
      const partitions = {};
      
      nodes.forEach(node => {
        if (node.partitions && node.partitions.length > 0) {
          partitions[node.name] = node.partitions;
        }
      });
      
      return partitions;
    } catch (error) {
      logger.warn('Could not check for partitions:', error.message);
      return {};
    }
  }

  async hasPartitions() {
    const partitions = await this.getPartitions();
    return Object.keys(partitions).length > 0;
  }

  // Alarms
  async getAlarms() {
    try {
      return await this.makeRequest('GET', '/alarms');
    } catch (error) {
      logger.warn('Could not get alarms:', error.message);
      return [];
    }
  }

  async getCriticalAlarms() {
    const alarms = await this.getAlarms();
    return alarms.filter(alarm => 
      alarm.alarm === 'memory_alarm' || 
      alarm.alarm === 'disk_alarm' ||
      alarm.alarm === 'file_descriptor_alarm'
    );
  }

  // Cluster health validation
  async validateClusterHealth() {
    const topology = config.getTopology();
    const issues = [];
    let healthyNodes = 0;
    
    try {
      // Check each node
      for (const topologyNode of topology.nodes) {
        try {
          const health = await this.checkNodeHealth(topologyNode.id);
          
          if (health.isHealthy) {
            healthyNodes++;
          } else {
            issues.push(`${topologyNode.name}: ${health.issues.join(', ')}`);
          }
        } catch (error) {
          issues.push(`${topologyNode.name}: Health check failed - ${error.message}`);
        }
      }
      
      // Check for critical alarms
      const criticalAlarms = await this.getCriticalAlarms();
      if (criticalAlarms.length > 0) {
        issues.push(`Critical alarms: ${criticalAlarms.map(a => a.alarm).join(', ')}`);
      }
      
      // Check for partitions
      const hasPartitions = await this.hasPartitions();
      if (hasPartitions) {
        const partitions = await this.getPartitions();
        issues.push(`Network partitions detected: ${JSON.stringify(partitions)}`);
      }
      
    } catch (error) {
      issues.push(`Cluster validation failed: ${error.message}`);
    }
    
    const isHealthy = issues.length === 0;
    const allNodesHealthy = healthyNodes === topology.nodes.length;
    
    return {
      healthy: isHealthy,
      allNodesHealthy,
      totalNodes: topology.nodes.length,
      healthyNodes,
      issues,
      canStartRollingRestart: isHealthy && allNodesHealthy,
      timestamp: new Date().toISOString()
    };
  }

  // Test connectivity to all nodes
  async testConnectivity() {
    const topology = config.getTopology();
    const results = [];
    
    for (const node of topology.nodes) {
      try {
        const startTime = Date.now();
        await this.makeRequest('GET', '/overview', null, node);
        const duration = Date.now() - startTime;
        
        results.push({
          node: node.name,
          hostIp: node.hostIp,
          managementPort: node.managementPort,
          connected: true,
          duration: `${duration}ms`
        });
      } catch (error) {
        results.push({
          node: node.name,
          hostIp: node.hostIp,
          managementPort: node.managementPort,
          connected: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

export const rabbitmqService = new RabbitMQService();
