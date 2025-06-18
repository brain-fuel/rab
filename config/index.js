import fs from 'fs';
import yaml from 'js-yaml';
import { logger } from '../utils/logger.js';

class ConfigManager {
  constructor() {
    this.topology = null;
    this.environment = null;
    this.loadConfiguration();
  }

  loadConfiguration() {
    this.loadTopology();
    this.loadEnvironment();
    this.validateConfiguration();
  }

  loadTopology() {
    try {
      const topologyPath = process.env.TOPOLOGY_FILE || './config/topology.yaml';
      if (!fs.existsSync(topologyPath)) {
        throw new Error(`Topology file not found: ${topologyPath}`);
      }
      
      const fileContents = fs.readFileSync(topologyPath, 'utf8');
      this.topology = yaml.load(fileContents);
      
      // Sort nodes by configOrder to ensure correct restart sequence
      this.topology.nodes.sort((a, b) => a.configOrder - b.configOrder);
      
      logger.info(`✅ Loaded topology: ${this.topology.clusterName} with ${this.topology.nodes.length} nodes`);
      logger.info(`📋 Node restart order: ${this.topology.nodes.map(n => `${n.configOrder}:${n.name}`).join(', ')}`);
    } catch (error) {
      logger.error('❌ Failed to load topology configuration:', error);
      throw error;
    }
  }

  loadEnvironment() {
    this.environment = {
      // Authentication
      rabbitMQUser: process.env.RABBITMQ_ADMIN_USER || 'admin',
      rabbitMQPassword: process.env.RABBITMQ_ADMIN_PASSWORD,
      apiKey: process.env.API_KEY,
      
      // API Configuration
      managementAPIBase: process.env.RABBITMQ_MANAGEMENT_API_BASE || 'http://localhost:15672/api',
      apiTimeout: parseInt(process.env.API_TIMEOUT) || 30000,
      
      // Health Check Configuration
      healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 10,
      healthCheckRetries: parseInt(process.env.HEALTH_CHECK_RETRIES) || 3,
      healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 10000,
      
      // Rolling Restart Configuration
      restartTimeout: parseInt(process.env.RESTART_TIMEOUT) || 300000,
      connectionDrainTimeout: parseInt(process.env.CONNECTION_DRAIN_TIMEOUT) || 30000,
      connectionDrainCheckInterval: parseInt(process.env.CONNECTION_DRAIN_CHECK_INTERVAL) || 2000,
      postRestartValidationTime: parseInt(process.env.POST_RESTART_VALIDATION_TIME) || 15000,
      interNodeDelay: parseInt(process.env.INTER_NODE_DELAY) || 5000,
      
      // Safety Configuration
      enableRollingRestart: process.env.ENABLE_ROLLING_RESTART === 'true',
      requireAllNodesHealthy: process.env.REQUIRE_ALL_NODES_HEALTHY !== 'false',
      allowRestartWithPartitions: process.env.ALLOW_RESTART_WITH_PARTITIONS === 'true',
      
      // SSH Configuration (optional)
      sshKeyPath: process.env.SSH_KEY_PATH,
      sshUser: process.env.SSH_USER || 'ubuntu',
      sshPassword: process.env.SSH_PASSWORD,
      
      // Notifications
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
      emailNotifications: process.env.EMAIL_NOTIFICATIONS === 'true'
    };

    logger.info('✅ Environment configuration loaded');
    logger.info(`🔒 API key configured: ${this.environment.apiKey ? 'Yes' : 'No'}`);
    logger.info(`🔐 SSH authentication: ${this.environment.sshKeyPath ? 'Key' : this.environment.sshPassword ? 'Password' : 'None'}`);
  }

  validateConfiguration() {
    const required = ['rabbitMQPassword'];
    const missing = required.filter(key => !this.environment[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (!this.topology) {
      throw new Error('Topology configuration is required');
    }

    if (!this.topology.nodes || this.topology.nodes.length === 0) {
      throw new Error('At least one node must be defined in topology');
    }

    // Validate node configuration
    const nodeValidationErrors = [];
    this.topology.nodes.forEach((node, index) => {
      if (!node.id) nodeValidationErrors.push(`Node ${index}: 'id' is required`);
      if (!node.name) nodeValidationErrors.push(`Node ${index}: 'name' is required`);
      
      // Support both hostname and hostIp
      if (!node.hostname && !node.hostIp) {
        nodeValidationErrors.push(`Node ${index}: either 'hostname' or 'hostIp' is required`);
      }
      
      if (typeof node.configOrder !== 'number') {
        nodeValidationErrors.push(`Node ${index}: 'configOrder' must be a number`);
      }

      // Validate ports
      if (node.port && (node.port < 1 || node.port > 65535)) {
        nodeValidationErrors.push(`Node ${index}: 'port' must be between 1 and 65535`);
      }
      if (node.managementPort && (node.managementPort < 1 || node.managementPort > 65535)) {
        nodeValidationErrors.push(`Node ${index}: 'managementPort' must be between 1 and 65535`);
      }
    });

    if (nodeValidationErrors.length > 0) {
      throw new Error(`Node configuration errors:\n${nodeValidationErrors.join('\n')}`);
    }

    // Validate unique configOrder values
    const configOrders = this.topology.nodes.map(n => n.configOrder);
    const duplicateOrders = configOrders.filter((order, index) => configOrders.indexOf(order) !== index);
    if (duplicateOrders.length > 0) {
      throw new Error(`Duplicate configOrder values found: ${duplicateOrders.join(', ')}`);
    }

    // Validate safety configuration
    if (!this.environment.enableRollingRestart) {
      logger.warn('⚠️ Rolling restart is disabled in configuration');
    }

    if (this.environment.allowRestartWithPartitions) {
      logger.warn('⚠️ WARNING: Rolling restart with partitions is allowed - this is dangerous!');
    }

    logger.info('✅ Configuration validation passed');
    logger.info(`🏭 Cluster: ${this.topology.clusterName} (${this.topology.version})`);
    logger.info(`📡 Node IPs: ${this.topology.nodes.map(n => `${n.name}:${n.hostIp || n.hostname}`).join(', ')}`);
  }

  getTopology() {
    return this.topology;
  }

  getEnvironment() {
    return this.environment;
  }

  getNodeByName(nodeName) {
    return this.topology.nodes.find(node => node.name === nodeName);
  }

  getNodeById(nodeId) {
    return this.topology.nodes.find(node => node.id === nodeId);
  }

  getAllNodes() {
    // Return nodes in configOrder (already sorted in loadTopology)
    return [...this.topology.nodes];
  }

  getNodesInRestartOrder() {
    // Explicitly sort by configOrder for clarity
    return [...this.topology.nodes].sort((a, b) => a.configOrder - b.configOrder);
  }

  getRestartConfig() {
    return this.topology.restartConfig || {};
  }

  isRollingRestartEnabled() {
    return this.environment.enableRollingRestart;
  }

  requiresAllNodesHealthy() {
    return this.environment.requireAllNodesHealthy;
  }

  allowsRestartWithPartitions() {
    return this.environment.allowRestartWithPartitions;
  }

  reload() {
    logger.info('🔄 Reloading configuration...');
    try {
      this.loadConfiguration();
      logger.info('✅ Configuration reloaded successfully');
    } catch (error) {
      logger.error('❌ Failed to reload configuration:', error);
      throw error;
    }
  }

  // Helper method to get timeout values in milliseconds
  getTimeouts() {
    const env = this.environment;
    const restart = this.topology.restartConfig || {};
    
    return {
      api: env.apiTimeout,
      healthCheck: env.healthCheckTimeout,
      restart: env.restartTimeout,
      connectionDrain: env.connectionDrainTimeout,
      connectionDrainCheck: env.connectionDrainCheckInterval,
      postRestartValidation: env.postRestartValidationTime,
      interNode: env.interNodeDelay,
      nodeStartup: (restart.nodeStartupTimeout || 120) * 1000,
      healthCheckInterval: (restart.healthCheckInterval || 10) * 1000
    };
  }

  // Helper methods to get node connection details
  getNodeHost(node) {
    return node.hostIp || node.hostname;
  }

  getNodeManagementUrl(node) {
    const host = this.getNodeHost(node);
    const port = node.managementPort || 15672;
    return `http://${host}:${port}`;
  }

  getNodeConnectionString(node) {
    const host = this.getNodeHost(node);
    const port = node.port || 5672;
    return `${host}:${port}`;
  }

  // Get all management URLs for the cluster
  getManagementUrls() {
    return this.topology.nodes.map(node => ({
      name: node.name,
      id: node.id,
      url: this.getNodeManagementUrl(node),
      configOrder: node.configOrder
    }));
  }
  getSummary() {
    return {
      cluster: {
        name: this.topology?.clusterName,
        version: this.topology?.version,
        nodeCount: this.topology?.nodes?.length || 0
      },
      features: {
        rollingRestartEnabled: this.environment.enableRollingRestart,
        requireAllNodesHealthy: this.environment.requireAllNodesHealthy,
        allowRestartWithPartitions: this.environment.allowRestartWithPartitions,
        sshConfigured: !!(this.environment.sshKeyPath || this.environment.sshPassword),
        apiKeyConfigured: !!this.environment.apiKey
      },
      timeouts: this.getTimeouts()
    };
  }
}

// Export singleton instance
export const config = new ConfigManager();
