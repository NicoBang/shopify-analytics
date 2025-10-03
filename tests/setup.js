/**
 * Jest Test Setup
 *
 * Loads environment variables and configures test environment
 */

require('dotenv').config();

// Set longer timeout for integration tests
jest.setTimeout(30000);

// Global test configuration
global.testConfig = {
  apiBaseUrl: process.env.API_BASE_URL || 'https://shopify-analytics-nu.vercel.app/api',
  apiKey: process.env.API_SECRET_KEY || 'bda5da3d49fe0e7391fded3895b5c6bc'
};
