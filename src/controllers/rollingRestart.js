import { rollingRestartService } from '../services/rollingRestart.js';
import { logger, apiLogger, rollingRestartLogger } from '../utils/logger.js';
import { config } from '../config/index.js';

export const startRollingRestart = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { 
      dryRun = false, 
      force = false, 
      reason = 'Manual restart via API',
      skipValidation = false 
    } = req.body;
    
    const initiator = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // Log the restart attempt
    logger.info('🚀 Rolling restart requested', {
      dryRun,
      force,
      reason,
      initiator,
      userAgent,
      skipValidation
    });
    
    // Check if rolling restart is enabled
    if (!config.isRollingRestartEnabled()) {
      return res.status(403).json({
        error: 'Rolling restart is disabled',
        message: 'ENABLE_ROLLING_RESTART must be set to true',
        timestamp: new Date().toISOString()
      });
    }
    
    // Handle dry run mode
    if (dryRun) {
      logger.info('🧪 Performing dry run validation');
      
      try {
        const dryRunResult = await rollingRestartService.startRollingRestart({
          dryRun: true,
          reason,
          initiator: `${initiator} (dry-run)`
        });
        
        apiLogger.response(req, res, 0);
        
        return res.json({
          dryRun: true,
          success: true,
          ...dryRunResult,
          message: 'Dry run completed successfully - rolling restart would proceed',
          timestamp: new Date().toISOString()
        });
        
      } catch (dryRunError) {
        logger.warn('🧪 Dry run failed:', dryRunError.message);
        
        return res.status(400).json({
          dryRun: true,
          success: false,
          error: 'Dry run validation failed',
          message: dryRunError.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Validate force flag usage
    if (force && !skipValidation) {
      logger.warn('⚠️ Force flag used but skipValidation is false - force flag ignored for safety');
    }
    
    // Start actual rolling restart
    try {
      const startTime = Date.now();
      
      logger.info('🚀 Starting rolling restart', {
        cluster: config.getTopology().clusterName,
        reason,
        initiator
      });
      
      // This will throw an error if validation fails
      await rollingRestartService.startRollingRestart({
        reason,
        initiator: `${initiator} via API`,
        force: force && skipValidation,
        userAgent
      });
      
      const duration = Date.now() - startTime;
      
      rollingRestartLogger.complete({
        clusterName: config.getTopology().clusterName,
        totalDuration: `${Math.round(duration / 1000)}s`,
        nodesRestarted: config.getAllNodes().length,
        initiator
      });
      
      apiLogger.response(req, res, duration);
      
      res.json({
        success: true,
        message: 'Rolling restart completed successfully',
        restartId: `restart-${Date.now()}`,
        cluster: config.getTopology().clusterName,
        nodesRestarted: config.getAllNodes().length,
        duration: `${Math.round(duration / 1000)}s`,
        reason,
        initiator,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('💥 Rolling restart failed:', error);
      
      rollingRestartLogger.failed({
        clusterName: config.getTopology().clusterName,
        error: error.message,
        initiator,
        nodesCompleted: rollingRestartService.getState().progress.completed
      });
      
      apiLogger.error(req, error);
      
      res.status(400).json({
        success: false,
        error: 'Rolling restart failed',
        message: error.message,
        cluster: config.getTopology().clusterName,
        nodesCompleted: rollingRestartService.getState().progress.completed,
        reason,
        initiator,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('💥 Rolling restart request failed:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to process rolling restart request',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const getRollingRestartStatus = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const state = rollingRestartService.getState();
    const progressPercent = rollingRestartService.getProgressPercent();
    const estimatedTimeRemaining = rollingRestartService.getEstimatedTimeRemaining();
    
    const response = {
      ...state,
      progressPercent,
      estimatedTimeRemaining,
      phaseDetails: getPhaseDetails(state.phase),
      timestamp: new Date().toISOString()
    };
    
    // Add additional context based on phase
    if (state.phase === 'draining' && state.currentNodeConnections !== null) {
      response.connectionsDraining = state.currentNodeConnections;
    }
    
    if (state.errors.length > 0) {
      response.lastError = state.errors[state.errors.length - 1];
    }
    
    apiLogger.response(req, res, 0);
    res.json(response);
    
  } catch (error) {
    logger.error('Failed to get rolling restart status:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to get rolling restart status',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const cancelRollingRestart = async (req, res) => {
  try {
    apiLogger.request(req);
    
    const { reason = 'Manual cancellation via API' } = req.body;
    const initiator = req.ip || 'unknown';
    
    if (!rollingRestartService.isActive) {
      return res.status(400).json({
        error: 'No rolling restart in progress',
        message: 'Cannot cancel a rolling restart that is not currently running',
        timestamp: new Date().toISOString()
      });
    }
    
    const currentState = rollingRestartService.getState();
    
    logger.warn('⚠️ Rolling restart cancellation requested', {
      reason,
      initiator,
      currentPhase: currentState.phase,
      currentNode: currentState.progress.current,
      nodesCompleted: currentState.progress.completed
    });
    
    await rollingRestartService.cancel();
    
    rollingRestartLogger.cancelled({
      clusterName: config.getTopology().clusterName,
      reason,
      initiator,
      nodesCompleted: currentState.progress.completed,
      phase: currentState.phase
    });
    
    apiLogger.response(req, res, 0);
    
    res.json({
      success: true,
      message: 'Rolling restart cancelled',
      reason,
      initiator,
      nodesCompleted: currentState.progress.completed,
      cancelledAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to cancel rolling restart:', error);
    apiLogger.error(req, error);
    
    res.status(400).json({
      error: 'Failed to cancel rolling restart',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const getRollingRestartHistory = async (req, res) => {
  try {
    apiLogger.request(req);
    
    // This would typically read from a database or log files
    // For now, return a placeholder that could be implemented
    const { limit = 10 } = req.query;
    
    // TODO: Implement actual history tracking
    // This could read from logs, database, or file system
    const mockHistory = [
      {
        id: 'restart-1640995200000',
        cluster: config.getTopology().clusterName,
        startedAt: '2024-01-01T10:00:00Z',
        completedAt: '2024-01-01T10:12:30Z',
        status: 'completed',
        nodesRestarted: 3,
        duration: '12m 30s',
        reason: 'Monthly maintenance',
        initiator: '192.168.1.100'
      },
      {
        id: 'restart-1640908800000',
        cluster: config.getTopology().clusterName,
        startedAt: '2024-01-01T09:00:00Z',
        completedAt: null,
        status: 'failed',
        nodesRestarted: 1,
        duration: '5m 15s',
        reason: 'Security updates',
        initiator: '192.168.1.100',
        error: 'Node rabbitmq-02 failed to restart'
      }
    ];
    
    apiLogger.response(req, res, 0);
    
    res.json({
      history: mockHistory.slice(0, parseInt(limit)),
      total: mockHistory.length,
      cluster: config.getTopology().clusterName,
      note: 'History tracking not yet implemented - showing mock data',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get rolling restart history:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to get rolling restart history',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

export const validateRollingRestart = async (req, res) => {
  try {
    apiLogger.request(req);
    
    logger.info('🔍 Rolling restart validation requested');
    
    const validation = await rollingRestartService.validateClusterForRestart();
    const timeouts = config.getTimeouts();
    const restartOrder = config.getNodesInRestartOrder();
    
    const estimatedDuration = calculateEstimatedDuration(restartOrder.length, timeouts);
    
    const response = {
      ...validation,
      clusterInfo: {
        name: config.getTopology().clusterName,
        totalNodes: restartOrder.length,
        restartOrder: restartOrder.map(n => ({
          order: n.configOrder,
          name: n.name,
          hostIp: n.hostIp
        }))
      },
      estimatedDuration,
      timeouts: {
        connectionDrain: `${timeouts.connectionDrain / 1000}s`,
        nodeStartup: `${timeouts.nodeStartup / 1000}s`,
        postValidation: `${timeouts.postRestartValidation / 1000}s`,
        interNode: `${timeouts.interNode / 1000}s`
      },
      safetyChecks: {
        rollingRestartEnabled: config.isRollingRestartEnabled(),
        requireAllNodesHealthy: config.requiresAllNodesHealthy(),
        allowRestartWithPartitions: config.allowsRestartWithPartitions()
      },
      timestamp: new Date().toISOString()
    };
    
    const status = validation.canRestart ? 200 : 400;
    
    apiLogger.response(req, res, 0);
    res.status(status).json(response);
    
  } catch (error) {
    logger.error('Failed to validate rolling restart:', error);
    apiLogger.error(req, error);
    
    res.status(500).json({
      error: 'Failed to validate rolling restart',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Helper functions
function getPhaseDetails(phase) {
  const phaseDescriptions = {
    idle: 'No rolling restart in progress',
    preparing: 'Preparing node for restart - entering maintenance mode',
    draining: 'Waiting for connections to drain gracefully',
    restarting: 'Stopping and starting RabbitMQ service',
    validating: 'Waiting for node to become healthy and operational',
    completed: 'Rolling restart completed successfully',
    failed: 'Rolling restart failed',
    cancelled: 'Rolling restart was cancelled'
  };
  
  const phaseIcons = {
    idle: '💤',
    preparing: '🔧',
    draining: '💧',
    restarting: '🔄',
    validating: '⏳',
    completed: '✅',
    failed: '❌',
    cancelled: '⚠️'
  };
  
  return {
    description: phaseDescriptions[phase] || 'Unknown phase',
    icon: phaseIcons[phase] || '❓',
    phase
  };
}

function calculateEstimatedDuration(nodeCount, timeouts) {
  const perNodeTime = (
    (timeouts.connectionDrain / 1000) +  // Connection draining
    30 +  // Restart time estimate
    (timeouts.nodeStartup / 1000) +     // Startup wait
    (timeouts.postRestartValidation / 1000) + // Post validation
    (timeouts.interNode / 1000)         // Inter-node delay
  );
  
  const totalSeconds = nodeCount * perNodeTime;
  const minutes = Math.ceil(totalSeconds / 60);
  
  return {
    totalSeconds: Math.round(totalSeconds),
    totalMinutes: minutes,
    formatted: `${minutes} minutes`,
    perNode: `${Math.round(perNodeTime)} seconds`,
    breakdown: {
      connectionDrain: `${timeouts.connectionDrain / 1000}s per node`,
      restart: '~30s per node',
      healthValidation: `${timeouts.nodeStartup / 1000}s per node`,
      postValidation: `${timeouts.postRestartValidation / 1000}s per node`,
      interNodeDelay: `${timeouts.interNode / 1000}s between nodes`
    }
  };
}
