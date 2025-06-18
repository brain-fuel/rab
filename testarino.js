import dotenv from 'dotenv';
import { config } from './src/config/index.js';

// Load environment variables
dotenv.config();

console.log('=== ENVIRONMENT VARIABLES ===');
console.log('API_KEY:', process.env.API_KEY ? 'SET' : 'NOT SET');
console.log('RABBITMQ_ADMIN_USER:', process.env.RABBITMQ_ADMIN_USER);
console.log('RABBITMQ_ADMIN_PASSWORD:', process.env.RABBITMQ_ADMIN_PASSWORD ? 'SET' : 'NOT SET');
console.log('RABBITMQ_MANAGEMENT_API_BASE:', process.env.RABBITMQ_MANAGEMENT_API_BASE);
console.log('SSH_USER:', process.env.SSH_USER);
console.log('SSH_PASSWORD:', process.env.SSH_PASSWORD ? 'SET' : 'NOT SET');
console.log('SSH_KEY_PATH:', process.env.SSH_KEY_PATH);

console.log('\n=== CONFIG LOADING TEST ===');
try {
  const topology = config.getTopology();
  const environment = config.getEnvironment();
  
  console.log('✅ Config loaded successfully');
  console.log('Cluster name:', topology.clusterName);
  console.log('Number of nodes:', topology.nodes.length);
  
  console.log('\n=== NODE DETAILS ===');
  topology.nodes.forEach((node, i) => {
    console.log(`Node ${i + 1}:`);
    console.log(`  Name: ${node.name}`);
    console.log(`  Host IP: ${node.hostIp}`);
    console.log(`  Management Port: ${node.managementPort}`);
    console.log(`  SSH Port: ${node.sshPort}`);
  });
  
  console.log('\n=== AUTHENTICATION STATUS ===');
  console.log('API Key configured:', environment.apiKey ? 'Yes' : 'No');
  console.log('SSH Key Path:', environment.sshKeyPath || 'Not set');
  console.log('SSH Password:', environment.sshPassword ? 'Set' : 'Not set');
  console.log('SSH Authentication method:', 
    environment.sshKeyPath ? 'Key' : 
    environment.sshPassword ? 'Password' : 'None'
  );
  
} catch (error) {
  console.error('❌ Config loading failed:', error.message);
  console.error('Full error:', error);
}
