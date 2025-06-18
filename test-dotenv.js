// Test if dotenv is working
import dotenv from 'dotenv';

console.log('=== BEFORE dotenv.config() ===');
console.log('API_KEY:', process.env.API_KEY);
console.log('RABBITMQ_ADMIN_USER:', process.env.RABBITMQ_ADMIN_USER);

console.log('\n=== Loading dotenv ===');
const result = dotenv.config();

if (result.error) {
  console.error('❌ Error loading .env:', result.error);
} else {
  console.log('✅ dotenv.config() succeeded');
  console.log('Loaded keys:', Object.keys(result.parsed || {}));
}

console.log('\n=== AFTER dotenv.config() ===');
console.log('API_KEY:', process.env.API_KEY);
console.log('RABBITMQ_ADMIN_USER:', process.env.RABBITMQ_ADMIN_USER);
console.log('RABBITMQ_ADMIN_PASSWORD:', process.env.RABBITMQ_ADMIN_PASSWORD ? 'SET' : 'NOT SET');
console.log('SSH_USER:', process.env.SSH_USER);
console.log('SSH_PASSWORD:', process.env.SSH_PASSWORD ? 'SET' : 'NOT SET');

console.log('\n=== FILE CHECK ===');
import fs from 'fs';
const envExists = fs.existsSync('.env');
console.log('.env file exists:', envExists);

if (envExists) {
  const content = fs.readFileSync('.env', 'utf8');
  console.log('.env file size:', content.length, 'bytes');
  console.log('First line:', content.split('\n')[0]);
}
