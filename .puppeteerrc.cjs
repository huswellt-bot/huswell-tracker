/* eslint-disable @typescript-eslint/no-require-imports */
const { join } = require("path");

/** @type {import('puppeteer').Configuration} */
module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
