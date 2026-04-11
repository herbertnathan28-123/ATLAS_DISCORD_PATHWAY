const { join } = require('path');

/**
 * Puppeteer config — ensures Chrome is cached inside the project directory
 * so it persists between Render's build and runtime phases.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
