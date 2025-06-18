import dotenv from 'dotenv';
import fs from 'fs';
import yaml from 'js-yaml';

// Load environment variables
dotenv.config();

console.log('=== STEP 1: CHECK .ENV FILE ===');
try {
  const envExists = fs.existsSync('.env');
  console.log('.env file exists:', envExists);
  
  if (envExists) {
    const envContent = fs.readFileSync('.env', 'utf8');
    console.log('.env file size:', envContent.length, 'characters');
    console.log('First few lines:');
    console.log(envContent.split('\n').slice(0, 5).join('\n'));
  }
} catch (error) {
  console.error('Error reading .env file:', error.message);
}

console.log('\n=== STEP 2: CHECK ENVIRONMENT VARIABLES ===');
console.log('API_KEY:', process.env.API_KEY ? `SET (${process.env.API_KEY.substring(0, 5)}...)` : 'NOT SET');
console.log('RABBITMQ_ADMIN_USER:', process.env.RABBITMQ_ADMIN_USER || 'NOT SET');
console.log('RABBITMQ_ADMIN_PASSWORD:', process.env.RABBITMQ_ADMIN_PASSWORD ? 'SET' : 'NOT SET');
console.log('RABBITMQ_MANAGEMENT_API_BASE:', process.env.RABBITMQ_MANAGEMENT_API_BASE || 'NOT SET');
console.log('SSH_USER:', process.env.SSH_USER || 'NOT SET');
console.log('SSH_PASSWORD:', process.env.SSH_PASSWORD ? 'SET' : 'NOT SET');
console.log('SSH_KEY_PATH:', process.env.SSH_KEY_PATH || 'NOT SET');

console.log('\n=== STEP 3: CHECK TOPOLOGY FILE ===');
try {
  const topologyExists = fs.existsSync('./config/topology.yaml');
  console.log('topology.yaml exists:', topologyExists);
  
  if (topologyExists) {
    const topologyContent = fs.readFileSync('./config/topology.yaml', 'utf8');
    console.log('topology.yaml size:', topologyContent.length, 'characters');
    
    const parsedTopology = yaml.load(topologyContent);
    console.log('YAML parsed successfully');
    console.log('Cluster name:', parsedTopology.clusterName);
    console.log('Number of nodes:', parsedTopology.nodes ? parsedTopology.nodes.length : 0);
    
    if (parsedTopology.nodes && parsedTopology.nodes.length > 0) {
      console.log('First node details:');
      const firstNode = parsedTopology.nodes[0];
      console.log('  Name:', firstNode.name);
      console.log('  Host IP:', firstNode.hostIp);
      console.log('  Management Port:', firstNode.managementPort, '(type:', typeof firstNode.managementPort, ')');
    }
  }
} catch (error) {
  console.error('Error with topology file:', error.message);
}

console.log('\n=== STEP 4: FINAL STATUS ===');
const hasApiKey = !!process.env.API_KEY;
const hasRabbitMQCreds = !!(process.env.RABBITMQ_ADMIN_USER && process.env.RABBITMQ_ADMIN_PASSWORD);
const hasSSH = !!(process.env.SSH_USER && (process.env.SSH_PASSWORD || process.env.SSH_KEY_PATH));

console.log('✅ API Key configured:', hasApiKey);
console.log('✅ RabbitMQ credentials:', hasRabbitMQCreds);
console.log('✅ SSH authentication:', hasSSH);
console.log('Ready to start app:', hasApiKey && hasRabbitMQCreds && hasSSH);
