import { NodeSSH } from 'node-ssh';
import { logger, sshLogger } from '../utils/logger.js';
import { config } from '../config/index.js';

class NodeService {
  constructor() {
    this.sshClients = new Map();
    this.connectionPool = new Map();
  }

  async getSSHClient(node) {
    const nodeKey = `${node.hostIp}:${node.sshPort || 22}`;
    
    // Return existing connection if available and connected
    if (this.sshClients.has(nodeKey)) {
      const existingClient = this.sshClients.get(nodeKey);
      if (existingClient.connection && existingClient.connection.sock && !existingClient.connection.sock.destroyed) {
        return existingClient;
      } else {
        // Clean up dead connection
        this.sshClients.delete(nodeKey);
      }
    }

    const ssh = new NodeSSH();
    const env = config.getEnvironment();
    const host = config.getNodeHost(node);
    
    const connectionConfig = {
      host: host,
      username: env.sshUser,
      port: node.sshPort || 22,
      readyTimeout: 30000,
      keepaliveInterval: 5000
    };

    // Use SSH key if available, otherwise password
    if (env.sshKeyPath) {
      connectionConfig.privateKeyPath = env.sshKeyPath;
    } else if (env.sshPassword) {
      connectionConfig.password = env.sshPassword;
    } else {
      throw new Error(`No SSH authentication method configured for ${host}. Set SSH_KEY_PATH or SSH_PASSWORD`);
    }

    try {
      sshLogger.connect(host);
      await ssh.connect(connectionConfig);
      
      this.sshClients.set(nodeKey, ssh);
      sshLogger.success(host, 'connect', 'SSH connection established');
      
      return ssh;
    } catch (error) {
      sshLogger.error(host, 'connect', error);
      throw new Error(`SSH connection failed to ${host}: ${error.message}`);
    }
  }

  async executeCommand(node, command, options = {}) {
    const host = config.getNodeHost(node);
    const { sudo = false, timeout = 60000 } = options;
    
    // Add sudo prefix if requested
    const finalCommand = sudo ? `sudo ${command}` : command;
    
    try {
      sshLogger.command(host, finalCommand);
      
      const ssh = await this.getSSHClient(node);
      const result = await ssh.execCommand(finalCommand, {
        cwd: '/home/' + config.getEnvironment().sshUser,
        execOptions: {
          pty: sudo, // Use pty for sudo commands
        },
        stream: 'stdout',
        options: {
          timeout: timeout
        }
      });
      
      if (result.code !== 0) {
        const error = new Error(`Command failed with code ${result.code}: ${result.stderr || result.stdout}`);
        sshLogger.error(host, finalCommand, error);
        throw error;
      }
      
      sshLogger.success(host, finalCommand, result.stdout);
      return result.stdout.trim();
    } catch (error) {
      sshLogger.error(host, finalCommand, error);
      throw new Error(`Command execution failed on ${host}: ${error.message}`);
    }
  }

  async restartNode(node) {
    const host = config.getNodeHost(node);
    logger.info(`🔄 Restarting RabbitMQ on ${node.name} (${host})`);
    
    try {
      // Check if RabbitMQ service exists and get its status
      logger.info(`🔍 Checking RabbitMQ service status on ${node.name}`);
      await this.executeCommand(node, 'systemctl is-active rabbitmq-server || echo "inactive"', { sudo: true });
      
      // Stop RabbitMQ gracefully
      logger.info(`🛑 Stopping RabbitMQ on ${node.name}`);
      await this.executeCommand(node, 'systemctl stop rabbitmq-server', { 
        sudo: true, 
        timeout: 30000 
      });
      
      // Wait a moment for clean shutdown
      await this.delay(3000);
      
      // Verify it's stopped
      const stopStatus = await this.executeCommand(node, 'systemctl is-active rabbitmq-server || echo "inactive"', { sudo: true });
      if (stopStatus.includes('active')) {
        logger.warn(`⚠️ RabbitMQ still active on ${node.name}, force stopping...`);
        await this.executeCommand(node, 'systemctl kill rabbitmq-server', { sudo: true });
        await this.delay(2000);
      }
      
      // Start RabbitMQ
      logger.info(`▶️ Starting RabbitMQ on ${node.name}`);
      await this.executeCommand(node, 'systemctl start rabbitmq-server', { 
        sudo: true, 
        timeout: 45000 
      });
      
      // Wait for service to initialize
      logger.info(`⏳ Waiting for RabbitMQ to initialize on ${node.name}`);
      await this.delay(10000);
      
      // Verify it's running
      const startStatus = await this.executeCommand(node, 'systemctl is-active rabbitmq-server', { sudo: true });
      if (!startStatus.includes('active')) {
        throw new Error(`RabbitMQ failed to start properly: ${startStatus}`);
      }
      
      // Additional verification - check if RabbitMQ is responding
      logger.info(`✅ Verifying RabbitMQ is responding on ${node.name}`);
      try {
        await this.executeCommand(node, 'rabbitmqctl node_health_check', { 
          sudo: true, 
          timeout: 30000 
        });
        logger.info(`✅ RabbitMQ health check passed on ${node.name}`);
      } catch (healthError) {
        logger.warn(`⚠️ Health check failed on ${node.name}, but service is running: ${healthError.message}`);
      }
      
      logger.info(`✅ Successfully restarted RabbitMQ on ${node.name}`);
      
    } catch (error) {
      logger.error(`❌ Failed to restart ${node.name}:`, error);
      throw new Error(`RabbitMQ restart failed on ${host}: ${error.message}`);
    }
  }

  async stopNode(node) {
    const host = config.getNodeHost(node);
    logger.info(`🛑 Stopping RabbitMQ on ${node.name} (${host})`);
    
    try {
      // Graceful stop
      await this.executeCommand(node, 'systemctl stop rabbitmq-server', { 
        sudo: true, 
        timeout: 30000 
      });
      
      // Verify it's stopped
      await this.delay(2000);
      const status = await this.executeCommand(node, 'systemctl is-active rabbitmq-server || echo "inactive"', { sudo: true });
      
      if (status.includes('active')) {
        logger.warn(`⚠️ Graceful stop failed, force stopping RabbitMQ on ${node.name}`);
        await this.executeCommand(node, 'systemctl kill rabbitmq-server', { sudo: true });
        await this.delay(3000);
      }
      
      logger.info(`✅ Stopped RabbitMQ on ${node.name}`);
    } catch (error) {
      logger.error(`❌ Failed to stop ${node.name}:`, error);
      throw new Error(`RabbitMQ stop failed on ${host}: ${error.message}`);
    }
  }

  async startNode(node) {
    const host = config.getNodeHost(node);
    logger.info(`▶️ Starting RabbitMQ on ${node.name} (${host})`);
    
    try {
      // Start the service
      await this.executeCommand(node, 'systemctl start rabbitmq-server', { 
        sudo: true, 
        timeout: 45000 
      });
      
      // Wait for service to initialize
      logger.info(`⏳ Waiting for RabbitMQ to initialize on ${node.name}`);
      await this.delay(10000);
      
      // Verify it's running
      const status = await this.executeCommand(node, 'systemctl is-active rabbitmq-server', { sudo: true });
      if (!status.includes('active')) {
        throw new Error(`RabbitMQ failed to start: ${status}`);
      }
      
      logger.info(`✅ Started RabbitMQ on ${node.name}`);
      
    } catch (error) {
      logger.error(`❌ Failed to start ${node.name}:`, error);
      throw new Error(`RabbitMQ start failed on ${host}: ${error.message}`);
    }
  }

  async getNodeStatus(node) {
    const host = config.getNodeHost(node);
    
    try {
      const result = await this.executeCommand(node, 'systemctl is-active rabbitmq-server', { sudo: true });
      const isActive = result.trim() === 'active';
      
      logger.debug(`📊 Node status for ${node.name}: ${isActive ? 'active' : 'inactive'}`);
      return {
        node: node.name,
        host: host,
        active: isActive,
        status: result.trim(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`❌ Failed to get status for ${node.name}:`, error);
      return {
        node: node.name,
        host: host,
        active: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getRabbitMQVersion(node) {
    try {
      const version = await this.executeCommand(node, 'rabbitmqctl version', { sudo: true });
      return version.trim();
    } catch (error) {
      logger.warn(`Could not get RabbitMQ version for ${node.name}:`, error.message);
      return 'unknown';
    }
  }

  async getSystemInfo(node) {
    const host = config.getNodeHost(node);
    
    try {
      const [uptime, loadavg, meminfo, diskspace] = await Promise.all([
        this.executeCommand(node, 'uptime').catch(() => 'unknown'),
        this.executeCommand(node, 'cat /proc/loadavg').catch(() => 'unknown'),
        this.executeCommand(node, 'cat /proc/meminfo | head -3').catch(() => 'unknown'),
        this.executeCommand(node, 'df -h /').catch(() => 'unknown')
      ]);
      
      return {
        node: node.name,
        host: host,
        uptime: uptime.trim(),
        loadavg: loadavg.trim(),
        memory: meminfo.trim(),
        disk: diskspace.trim(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Failed to get system info for ${node.name}:`, error);
      return {
        node: node.name,
        host: host,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async testSSHConnectivity() {
    const topology = config.getTopology();
    const results = [];
    
    for (const node of topology.nodes) {
      const host = config.getNodeHost(node);
      
      try {
        const startTime = Date.now();
        await this.executeCommand(node, 'echo "SSH test successful"');
        const duration = Date.now() - startTime;
        
        results.push({
          node: node.name,
          host: host,
          connected: true,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        results.push({
          node: node.name,
          host: host,
          connected: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    return results;
  }

  async getAllNodeStatuses() {
    const topology = config.getTopology();
    const statuses = [];
    
    for (const node of topology.nodes) {
      const status = await this.getNodeStatus(node);
      statuses.push(status);
    }
    
    return statuses;
  }

  async closeAllConnections() {
    logger.info('🔌 Closing all SSH connections...');
    
    for (const [nodeKey, ssh] of this.sshClients) {
      try {
        ssh.dispose();
        logger.info(`📡 Closed SSH connection to ${nodeKey}`);
      } catch (error) {
        logger.error(`Failed to close SSH connection to ${nodeKey}:`, error.message);
      }
    }
    
    this.sshClients.clear();
    logger.info('✅ All SSH connections closed');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const nodeService = new NodeService();

// Cleanup on process exit
process.on('exit', () => {
  nodeService.closeAllConnections();
});

process.on('SIGTERM', () => {
  nodeService.closeAllConnections();
});

process.on('SIGINT', () => {
  nodeService.closeAllConnections();
});
