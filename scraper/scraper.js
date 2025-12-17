const redis = require('ioredis');

const redisClient = redis.createClient();

// Get process ID for PM2 cluster mode
const processId = process.pid;
const instanceId = process.env.NODE_APP_INSTANCE || '0';

redisClient.on('connect', () => {
  console.log(`[Worker PID: ${processId}, Instance: ${instanceId}] Connected to Redis server`);
});

redisClient.on('error', (err) => {
  console.error(`[Worker PID: ${processId}, Instance: ${instanceId}] Redis Client Error:`, err);
});

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main worker loop
async function startWorker() {
  console.log(`[Worker PID: ${processId}, Instance: ${instanceId}] Worker started and ready to process jobs`);
  
  while (true) {
    const job = await redisClient.rpop('link-request-queue');
    if (!job) {
      await sleep(3000);
      continue;
    }
    
    const jobData = JSON.parse(job);
    console.log(`[Worker PID: ${processId}, Instance: ${instanceId}] Processing job:`, jobData);
    
    // Search for job links and save to JSON file
    try {
      const { searchAndSaveJobLinks } = require('./jobSearch/jobSearcher');
      await searchAndSaveJobLinks(jobData, processId.toString());
    } catch (error) {
      console.error(`[Worker PID: ${processId}, Instance: ${instanceId}] Error processing job:`, error.message);
    }
    
    await sleep(3000);
  }
}

// Start the worker
startWorker().catch((error) => {
  console.error(`[Worker PID: ${processId}, Instance: ${instanceId}] Worker error:`, error);
  process.exit(1);
});
