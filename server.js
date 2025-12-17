const express = require('express');
const redis = require('ioredis');

const app = express();
const PORT = process.env.PORT || 3000;

// Create Redis client
const redisClient = redis.createClient({
  host: 'localhost',
  port: 6379
});

// Handle Redis connection events
redisClient.on('connect', () => {
  console.log('Connected to Redis server');
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// Connect to Redis


// Middleware
app.use(express.json());

// Test route to verify Redis connection

async function seedData(){  
    const jobData = [
        {
            role: 'Software Engineer',
            userId: '123',
            experience: '1-3 years',
            location: 'bangalore, India'
        },
        {
            role: 'Frontend Engineer',
            userId: '123',
            experience: '1-3 years',
            location: 'Delhi, India'
        },
        {
            role: 'Backend Engineer',
            userId: '123',
            experience: '1-3 years',
            location: 'Mumbai, India'
        },
        {
            role: 'Full Stack Engineer',
            userId: '123',
            experience: '1-3 years',
            location: 'Hyderabad, India'
        }
    ]

    for (const job of jobData) {
        await redisClient.lpush('link-request-queue', JSON.stringify(job));
    }

    console.log('Seed data added to Redis queue');
}

app.post('/api/v1/request-for-link', async (req, res) => {
  try {
    const { role, userId, experience, location } = req.body;
    // title = job role
    
    const jobData = {
      role,
      userId,
      experience,
      location
    };

    // Add jobData to Redis queue
    await redisClient.lpush('link-request-queue', JSON.stringify(jobData));
    
    res.status(200).json({ message: 'Link requested successfully, will show you data on frontend in few minutes' });
  } catch (error) {
    console.error('Error adding job to queue:', error);
    res.status(500).json({ error: 'Failed to add job to queue', message: error.message });
  }
});


app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  await seedData();
  console.log('Seed data added to Redis queue');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await redisClient.quit();
  process.exit(0);
});

