import { EventEmitter } from 'events';
import { logger, rollingRestartLogger } from '../utils/logger.js';
import { rabbitmqService } from './rabbitmq.js';
import { nodeService } from './nodeService.js';
import { config } from '../config/index.js';

class RollingRestartService extends EventEmitter {
  constructor() {
    super();
    this.isActive = false;
    this.currentState = {
      phase: 'idle',
      nodeIndex: 0,
      startedAt: null,
      completedAt: null,
      errors: [],
      progress: {
        total: 0,
        completed: 0,
        current: null
      },
      currentNodeConnections: null
    };
  }

  async validateClusterForRestart() {
    logger.info('🔍 Validating cluster for rolling restart...');
    
    try {
      // Use comprehensive validation from RabbitMQ service
      const validation = await rabbitmqService.validateClusterHealth();
      
      // Additional strict checks for rolling restart
      const reasons = [...validation.issues];
      
      // Ensure rolling restart is enabled in config
      if (!config.isRollingRestartEnabled()) {
        reasons.push('Rolling restart is disabled in configuration');
      }
      
      // Check minimum cluster size
      if (validation.totalNodes < 2) {
        reasons.push('Cluster must have at least 2 nodes for rolling restart');
      }
      
      // Strict requirement: ALL nodes must be healthy
      if (!validation.allNodesHealthy) {
        reasons.push(`Only ${validation.healthyNodes}/${validation.totalNodes} nodes are healthy - ALL nodes must be healthy for rolling restart`);
      }
      
      const canRestart = reasons.length === 0;
      
      logger.info(`🔍 Validation complete: ${canRestart ? 'PASS' : 'FAIL'}`, {
        canRestart,
        healthyNodes: validation.healthyNodes,
        totalNodes: validation.totalNodes,
        issueCount: reasons.length
      });
      
      if (reasons.length > 0) {
        logger.warn('❌ Rolling restart blocked:', { reasons });
      }
      
      return { canRestart, reasons };
      
    } catch (error) {
      logger.error('💥 Validation failed:', error);
      return {
        canRestart: false,
        reasons: [`Validation failed: ${error.message}`]
      };
    }
  }

  async startRollingRestart(options = {}) {
    if (this.isActive) {
      throw new Error('Rolling restart already in progress');
    }

    const { reason = 'Manual restart', initiator = 'unknown', dryRun = false } = options;

    // Validate cluster
    const validation = await this.validateClusterForRestart();
    if (!validation.canRestart) {
      const errorMsg = `Cannot start rolling restart: ${validation.reasons.join(', ')}`;
      logger.error('❌ Rolling restart rejected:', { reasons: validation.reasons });
      throw new Error(errorMsg);
    }

    const nodes = config.getNodesInRestartOrder();
    const clusterName = config.getTopology().clusterName;
    
    if (dryRun) {
      logger.info('🧪 Dry run mode - no actual restart will be performed');
      return {
        dryRun: true,
        nodes: nodes.map(n => n.name),
        estimatedDuration: `${nodes.length * 4} minutes`,
        message: 'Dry run completed - restart would proceed'
      };
    }

    this.isActive = true;
    this.currentState = {
      phase: 'preparing',
      nodeIndex: 0,
      startedAt: new Date(),
      completedAt: null,
      errors: [],
      progress: {
        total: nodes.length,
        completed: 0,
        current: null
      },
      currentNodeConnections: null
    };

    rollingRestartLogger.start({
      clusterName,
      nodeCount: nodes.length,
      reason,
      initiator,
      nodeOrder: nodes.map(n => `${n.configOrder}:${n.name}`)
    });

    this.emit('started', this.currentState);

    try {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const nodeStartTime = Date.now();
        
        this.currentState.nodeIndex = i;
        this.currentState.progress.current = node.name;
        
        rollingRestartLogger.nodeStart(node.name, node.configOrder);
        logger.info(`🔄 Processing node ${i + 1}/${nodes.length}: ${node.name} (order: ${node.configOrder})`);
        
        await this.processNode(node);
        
        const nodeDuration = Date.now() - nodeStartTime;
        this.currentState.progress.completed = i + 1;
        
        rollingRestartLogger.nodeComplete(node.name, node.configOrder, `${Math.round(nodeDuration / 1000)}s`);
        this.emit('progress', this.currentState);
        
        // Delay between nodes (except after last one)
        if (i < nodes.length - 1) {
          const delay = config.getTimeouts().interNode;
          logger.info(`⏸️ Waiting ${delay}ms before next node...`);
          await this.delay(delay);
        }
      }
      
      const totalDuration = Date.now() - this.currentState.startedAt.getTime();
      
      this.currentState.phase = 'completed';
      this.currentState.completedAt = new Date();
      this.currentState.progress.current = null;
      
      rollingRestartLogger.complete({
        clusterName,
        totalDuration: `${Math.round(totalDuration / 1000)}s`,
        nodesRestarted: nodes.length
      });
      
      logger.info('🎉 Rolling restart completed successfully', {
        duration: `${Math.round(totalDuration / 1000)}s`,
        nodesRestarted: nodes.length
      });
      
      this.emit('completed', this.currentState);
      return this.currentState;
      
    } catch (error) {
      this.currentState.phase = 'failed';
      this.currentState.errors.push(error.message);
      
      rollingRestartLogger.failed({
        clusterName,
        failedNode: this.currentState.progress.current,
        error: error.message,
        nodesCompleted: this.currentState.progress.completed
      });
      
      logger.error('💥 Rolling restart failed:', error);
      this.emit('failed', this.currentState);
      throw error;
    } finally {
      this.isActive = false;
    }
  }

  async processNode(node) {
    const timeouts = config.getTimeouts();
    
    try {
      // 1. Put node in maintenance mode
      this.currentState.phase = 'maintenance';
      this.emit('phase-change', this.currentState);
      
      logger.info(`🔧 Putting ${node.name} into maintenance mode`);
      await rabbitmqService.setMaintenanceMode(node.id, true, 'Rolling restart');
      
      // 2. Drain connections
      this.currentState.phase = 'draining';
      this.emit('phase-change', this.currentState);
      
      logger.info(`💧 Draining connections from ${node.name}`);
      await this.drainConnections(node);
      
      // 3. Restart node
      this.currentState.phase = 'restarting';
      this.emit('phase-change', this.currentState);
      
      logger.info(`🔄 Restarting ${node.name}`);
      await this.restartNode(node);
      
      // 4. Wait for health
      this.currentState.phase = 'validating';
      this.emit('phase-change', this.currentState);
      
      logger.info(`⏳ Waiting for ${node.name} to become healthy`);
      await this.waitForNodeHealth(node);
      
      // 5. Additional validation
      logger.info(`✅ Additional validation for ${node.name}`);
      await this.delay(timeouts.postRestartValidation);
      
      // 6. Remove from maintenance mode
      logger.info(`🔧 Removing ${node.name} from maintenance mode`);
      await rabbitmqService.setMaintenanceMode(node.id, false, 'Rolling restart completed');
      
      logger.info(`✅ Successfully processed ${node.name}`);
      
    } catch (error) {
      rollingRestartLogger.nodeError(node.name, node.configOrder, error);
      logger.error(`❌ Failed to process ${node.name}:`, error);
      
      // Try to remove from maintenance mode on error
      try {
        await rabbitmqService.setMaintenanceMode(node.id, false, 'Rolling restart failed - cleanup');
        logger.info(`🔧 Removed ${node.name} from maintenance mode (cleanup)`);
      } catch (cleanupError) {
        logger.error('Failed to remove maintenance mode during cleanup:', cleanupError);
      }
      
      throw error;
    }
  }

  async drainConnections(node) {
    const timeouts = config.getTimeouts();
    const startTime = Date.now();
    
    logger.info(`💧 Starting connection drain for ${node.name}`);
    
    while (Date.now() - startTime < timeouts.connectionDrain) {
      try {
        const connectionCount = await rabbitmqService.getConnectionCount(node.id);
        this.currentState.currentNodeConnections = connectionCount;
        
        logger.info(`💧 ${node.name} has ${connectionCount} active connections`);
        
        if (connectionCount === 0) {
          logger.info(`✅ All connections drained from ${node.name}`);
          this.currentState.currentNodeConnections = null;
          return;
        }
        
        await this.delay(timeouts.connectionDrainCheck);
      } catch (error) {
        logger.warn(`Could not check connections for ${node.name}:`, error.message);
        break;
      }
    }
    
    // Check final connection count
    try {
      const finalCount = await rabbitmqService.getConnectionCount(node.id);
      this.currentState.currentNodeConnections = null;
      
      if (finalCount > 0) {
        logger.warn(`⚠️ Connection drain timeout reached. ${finalCount} connections remain on ${node.name}`);
        
        // Optionally force close remaining connections
        const forceClose = config.getEnvironment().forceCloseConnectionsAfterDrain;
        if (forceClose && finalCount <= 10) { // Safety limit
          logger.info(`🔌 Force closing ${finalCount} remaining connections on ${node.name}`);
          await rabbitmqService.forceCloseNodeConnections(node.id, finalCount);
        }
      }
    } catch (error) {
      logger.warn(`Could not get final connection count for ${node.name}:`, error.message);
    }
  }

  async restartNode(node) {
    logger.info(`🔄 Restarting RabbitMQ on ${node.name} (${config.getNodeHost(node)})`);
    
    // Use nodeService for SSH-based restart (will be created separately)
    // For now, we'll use a placeholder that represents the restart operation
    try {
      // This would call the actual SSH service to restart the node
      // await nodeService.restartNode(node);
      
      // Placeholder for demonstration - simulate restart time
      await this.delay(3000);
      
      logger.info(`✅ RabbitMQ restart completed on ${node.name}`);
    } catch (error) {
      logger.error(`❌ Failed to restart ${node.name}:`, error);
      throw new Error(`Node restart failed: ${error.message}`);
    }
  }

  async waitForNodeHealth(node) {
    const timeouts = config.getTimeouts();
    const startTime = Date.now();
    const maxWaitTime = timeouts.nodeStartup;
    const checkInterval = timeouts.healthCheckInterval;
    
    logger.info(`⏳ Waiting for ${node.name} to become healthy (max ${maxWaitTime/1000}s)`);
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const health = await rabbitmqService.checkNodeHealth(node.id);
        
        if (health.isHealthy) {
          logger.info(`✅ ${node.name} is healthy and ready`);
          return;
        }
        
        logger.info(`⏳ ${node.name} not ready yet: ${health.issues.join(', ')}`);
        
      } catch (error) {
        logger.info(`⏳ ${node.name} health check failed: ${error.message}`);
      }
      
      await this.delay(checkInterval);
    }
    
    throw new Error(`Node ${node.name} failed to become healthy within ${maxWaitTime/1000} seconds`);
  }

  async cancel() {
    if (!this.isActive) {
      throw new Error('No rolling restart in progress');
    }
    
    const clusterName = config.getTopology().clusterName;
    
    rollingRestartLogger.cancelled({
      clusterName,
      reason: 'User cancellation',
      nodesCompleted: this.currentState.progress.completed
    });
    
    logger.warn('⚠️ Cancelling rolling restart');
    this.currentState.phase = 'cancelled';
    this.currentState.errors.push('Rolling restart cancelled by user');
    this.isActive = false;
    this.emit('cancelled', this.currentState);
  }

  getState() {
    return { 
      ...this.currentState, 
      isActive: this.isActive,
      clusterName: config.getTopology().clusterName
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get progress as percentage
  getProgressPercent() {
    if (this.currentState.progress.total === 0) return 0;
    return Math.round((this.currentState.progress.completed / this.currentState.progress.total) * 100);
  }

  // Get estimated time remaining
  getEstimatedTimeRemaining() {
    if (!this.isActive || !this.currentState.startedAt) return null;
    
    const elapsed = Date.now() - this.currentState.startedAt.getTime();
    const completed = this.currentState.progress.completed;
    const total = this.currentState.progress.total;
    
    if (completed === 0) return null;
    
    const avgTimePerNode = elapsed / completed;
    const remaining = (total - completed) * avgTimePerNode;
    
    return Math.round(remaining / 1000); // seconds
  }
}

export const rollingRestartService = new RollingRestartService();
