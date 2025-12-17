const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

/**
 * Searches a specific job board with pagination to get at least 20 results
 * @param {Object} query - Query object with name, url, and extractor function
 * @param {string} processId - Process ID for logging
 * @param {number} minResults - Minimum number of results to fetch (default: 20)
 * @returns {Promise<Array>} Array of job links from this source
 */
async function searchJobBoard(query, processId, minResults = 20) {
  const jobLinks = [];
  const maxPages = 5; // Maximum pages to search per platform
  let page = 0;

  try {
    while (jobLinks.length < minResults && page < maxPages) {
      try {
        const url = query.getUrl(page);
        console.log(`[Process ${processId}] Searching ${query.name} (page ${page + 1}) for: ${query.role} in ${query.location}`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          },
          timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const pageLinks = query.extractor($, query.name);
        
        if (pageLinks.length === 0) {
          console.log(`[Process ${processId}] No more results found on ${query.name} page ${page + 1}`);
          break;
        }

        jobLinks.push(...pageLinks);
        console.log(`[Process ${processId}] Found ${pageLinks.length} jobs on ${query.name} page ${page + 1}. Total: ${jobLinks.length}`);

        // If we got results but not enough, try next page
        if (jobLinks.length < minResults) {
          page++;
          await new Promise(resolve => setTimeout(resolve, 2000)); // Delay between pages
        }
      } catch (error) {
        console.error(`[Process ${processId}] Error on ${query.name} page ${page + 1}:`, error.message);
        break;
      }
    }

    // Return all collected results (we try to get at least minResults, but return what we have)
    console.log(`[Process ${processId}] ${query.name}: Collected ${jobLinks.length} jobs`);
    return jobLinks;

  } catch (error) {
    console.error(`[Process ${processId}] Error searching ${query.name}:`, error.message);
    return jobLinks; // Return whatever we collected
  }
}

/**
 * Searches for job links online based on job criteria from multiple platforms
 * @param {Object} jobData - Job search parameters
 * @param {string} jobData.role - Job role/title
 * @param {string} jobData.location - Job location
 * @param {string} jobData.experience - Experience level
 * @param {string} processId - Process ID for file naming
 * @returns {Promise<Object>} Object with channel-wise job links and statistics
 */
async function searchJobLinks(jobData, processId) {
  const { role, location, experience } = jobData;
  const allJobLinks = {};
  const channelStats = {};

  try {
    // Define all job board search configurations
    const jobBoards = [
      {
        name: 'LinkedIn',
        role: role,
        location: location,
        getUrl: (page) => {
          const start = page * 25;
          return `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}&start=${start}&f_TPR=r86400`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a.base-card__full-link, a.job-card-list__title').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).find('span.sr-only, h3.base-search-card__title').text().trim() || $(elem).text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'Naukri',
        role: role,
        location: location,
        getUrl: (page) => {
          const pageNum = page + 1;
          return `https://www.naukri.com/${encodeURIComponent(role.toLowerCase().replace(/\s+/g, '-'))}-jobs-in-${encodeURIComponent(location.toLowerCase().replace(/\s+/g, '-'))}?k=${encodeURIComponent(role)}&l=${encodeURIComponent(location)}&experience=${encodeURIComponent(experience)}&page=${pageNum}`;
        },
        extractor: ($, source) => {
          const links = [];
          $('a.title, a[data-job-id]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.naukri.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).text().trim() || $(elem).find('span').text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'Indeed',
        role: role,
        location: location,
        getUrl: (page) => {
          const start = page * 10;
          return `https://www.indeed.com/jobs?q=${encodeURIComponent(role)}&l=${encodeURIComponent(location)}&fromage=1&start=${start}`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a[data-jk], a[href*="/viewjob"]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.indeed.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).find('h2.jobTitle, span[title]').text().trim() || $(elem).text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'Glassdoor',
        role: role,
        location: location,
        getUrl: (page) => {
          const pageNum = page + 1;
          return `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(role)}&locT=C&locId=${encodeURIComponent(location)}&fromAge=1&page=${pageNum}`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a[data-test="job-link"], a.jobLink').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.glassdoor.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).find('div[data-test="job-title"], a[data-test="job-title"]').text().trim() || $(elem).text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'Monster',
        role: role,
        location: location,
        getUrl: (page) => {
          const pageNum = page + 1;
          return `https://www.monster.com/jobs/search?q=${encodeURIComponent(role)}&where=${encodeURIComponent(location)}&page=${pageNum}&postedDate=1`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a[data-test-id="svx-job-title"], a.sc-fzqBZW').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.monster.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'ZipRecruiter',
        role: role,
        location: location,
        getUrl: (page) => {
          const pageNum = page + 1;
          return `https://www.ziprecruiter.com/jobs-search?search=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}&page=${pageNum}&days=1`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a.job_link, a[data-testid="job-title"]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.ziprecruiter.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).text().trim() || $(elem).find('h2, h3').text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'SimplyHired',
        role: role,
        location: location,
        getUrl: (page) => {
          const pageNum = page + 1;
          return `https://www.simplyhired.com/search?q=${encodeURIComponent(role)}&l=${encodeURIComponent(location)}&fdb=1&page=${pageNum}`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a[data-testid="job-title"], a.SerpJob-link').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.simplyhired.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      },
      {
        name: 'CareerBuilder',
        role: role,
        location: location,
        getUrl: (page) => {
          const pageNum = page + 1;
          return `https://www.careerbuilder.com/jobs?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}&posted=1&page=${pageNum}`; // Last 24 hours
        },
        extractor: ($, source) => {
          const links = [];
          $('a.data-results-content, a[data-testid="job-title"]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
              const fullUrl = href.startsWith('http') ? href : `https://www.careerbuilder.com${href}`;
              links.push({
                url: fullUrl,
                title: $(elem).text().trim() || $(elem).find('h2, h3').text().trim(),
                channel: source,
                source: source, // Backward compatibility
                scrapedAt: new Date().toISOString()
              });
            }
          });
          return links;
        }
      }
    ];

    // Search each job board with minimum 20 results requirement
    for (const board of jobBoards) {
      try {
        const boardResults = await searchJobBoard(board, processId, 20);
        if (boardResults.length > 0) {
          allJobLinks[board.name] = boardResults;
          channelStats[board.name] = boardResults.length;
        }
        // Add delay between different platforms
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`[Process ${processId}] Error searching ${board.name}:`, error.message);
        channelStats[board.name] = 0;
      }
    }

    // Also try Google Jobs search for additional results
    try {
      console.log(`[Process ${processId}] Searching Google Jobs for: ${role} in ${location}`);
      const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${role} jobs ${location} ${experience}`)}&tbm=job&tbs=qdr:d`; // Last 24 hours
      const response = await axios.get(googleSearchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const googleLinks = [];
      $('a[href*="/url?q="], a[data-ved]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href) {
          let jobUrl = href;
          if (href.includes('/url?q=')) {
            const urlMatch = href.match(/\/url\?q=([^&]+)/);
            if (urlMatch && urlMatch[1]) {
              jobUrl = decodeURIComponent(urlMatch[1]);
            }
          }
          // Filter out non-job URLs
          if (jobUrl && (jobUrl.includes('job') || jobUrl.includes('career') || jobUrl.includes('hiring') || jobUrl.includes('position'))) {
            googleLinks.push({
              url: jobUrl,
              title: $(elem).text().trim() || $(elem).find('h3, h4').text().trim(),
              channel: 'Google Jobs',
              source: 'Google Jobs', // Backward compatibility
              scrapedAt: new Date().toISOString()
            });
          }
        }
      });

      if (googleLinks.length > 0) {
        allJobLinks['Google Jobs'] = googleLinks.slice(0, 20); // Limit to 20
        channelStats['Google Jobs'] = Math.min(googleLinks.length, 20);
      }
    } catch (error) {
      console.error(`[Process ${processId}] Error with Google search:`, error.message);
      channelStats['Google Jobs'] = 0;
    }

    // Combine all results and remove duplicates
    const allLinks = [];
    const seenUrls = new Set();
    
    for (const [channel, links] of Object.entries(allJobLinks)) {
      for (const link of links) {
        // Normalize URL for duplicate detection
        const normalizedUrl = link.url.split('?')[0].toLowerCase();
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          allLinks.push(link);
        }
      }
    }

    // Log statistics
    console.log(`[Process ${processId}] Job search completed:`);
    for (const [channel, count] of Object.entries(channelStats)) {
      console.log(`  ${channel}: ${count} jobs`);
    }
    console.log(`[Process ${processId}] Total unique jobs: ${allLinks.length}`);

    return {
      jobs: allLinks,
      channelStats: channelStats,
      totalJobs: allLinks.length
    };

  } catch (error) {
    console.error(`[Process ${processId}] Error in searchJobLinks:`, error.message);
    return {
      jobs: [],
      channelStats: {},
      totalJobs: 0
    };
  }
}

/**
 * Appends job links to a JSON file named with process_id
 * @param {Object} searchResults - Object containing jobs array, channelStats, and totalJobs
 * @param {string} processId - Process ID for file naming
 * @param {Object} jobData - Original job search data
 * @returns {Promise<void>}
 */
async function appendJobLinksToFile(searchResults, processId, jobData) {
  const fileName = `${processId}_jobs.json`;
  const filePath = path.join(__dirname, '..', 'data', fileName);
  
  // Create data directory if it doesn't exist
  const dataDir = path.dirname(filePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let existingData = {
    processId: processId,
    searchCriteria: jobData,
    jobs: [],
    channelStats: {},
    totalJobs: 0,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };

  // Read existing file if it exists
  if (fs.existsSync(filePath)) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      existingData = JSON.parse(fileContent);
      existingData.lastUpdated = new Date().toISOString();
    } catch (error) {
      console.error(`[Process ${processId}] Error reading existing file:`, error.message);
    }
  }

  // Append new job links (avoid duplicates)
  const existingUrls = new Set(existingData.jobs.map(job => {
    // Normalize URL for duplicate detection
    return job.url ? job.url.split('?')[0].toLowerCase() : '';
  }));
  
  const newJobs = searchResults.jobs.filter(link => {
    const normalizedUrl = link.url ? link.url.split('?')[0].toLowerCase() : '';
    return !existingUrls.has(normalizedUrl);
  });
  
  existingData.jobs.push(...newJobs);
  
  // Update channel statistics
  existingData.channelStats = searchResults.channelStats || {};
  
  // Calculate channel-wise counts from actual jobs
  const channelCounts = {};
  existingData.jobs.forEach(job => {
    const channel = job.channel || job.source || 'Unknown';
    channelCounts[channel] = (channelCounts[channel] || 0) + 1;
  });
  existingData.channelStats = channelCounts;
  
  existingData.totalJobs = existingData.jobs.length;

  // Write to file
  try {
    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf8');
    console.log(`[Process ${processId}] Appended ${newJobs.length} new job links to ${fileName}. Total: ${existingData.totalJobs}`);
    console.log(`[Process ${processId}] Channel breakdown:`, existingData.channelStats);
  } catch (error) {
    console.error(`[Process ${processId}] Error writing to file:`, error.message);
    throw error;
  }
}

/**
 * Main function to search and save job links
 * @param {Object} jobData - Job search parameters
 * @param {string} processId - Process ID for file naming
 * @returns {Promise<void>}
 */
async function searchAndSaveJobLinks(jobData, processId) {
  try {
    console.log(`[Process ${processId}] Starting job search for:`, jobData);
    
    // Search for job links from multiple platforms
    const searchResults = await searchJobLinks(jobData, processId);
    
    if (searchResults.jobs.length === 0) {
      console.log(`[Process ${processId}] No job links found`);
      return;
    }

    // Append to JSON file
    await appendJobLinksToFile(searchResults, processId, jobData);
    
    console.log(`[Process ${processId}] Job search completed successfully`);
    console.log(`[Process ${processId}] Summary: ${searchResults.totalJobs} total jobs from ${Object.keys(searchResults.channelStats).length} channels`);
  } catch (error) {
    console.error(`[Process ${processId}] Error in searchAndSaveJobLinks:`, error.message);
    throw error;
  }
}

module.exports = {
  searchJobLinks,
  appendJobLinksToFile,
  searchAndSaveJobLinks
};
