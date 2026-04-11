const { chromium } = require("playwright");
const sharp = require("sharp");

const WIDTH = 1600;
const HEIGHT = 900;

const TF_MAP = {
  "1W": "1W",
  "1D": "1D",
  "4H": "240",
  "1H": "60",
  "30M": "30",
  "15M": "15",
  "5M": "5",
  "1M": "1"
};

async function capture(symbol, timeframe) {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT }
  });

  const interval = TF_MAP[timeframe];

  const url =
    `https://www.tradingview.com/chart/?symbol=${symbol}` +
    `&interval=${interval}` +
    `&theme=dark`;

  await page.goto(url, { waitUntil: "networkidle" });

  await page.waitForTimeout(3500);

  const chart = await page.locator("canvas").first();

  const buffer = await chart.screenshot();

  await browser.close();

  return buffer;
}

async function buildGrid(symbol) {
  const tfs = [
    "1W",
    "1D",
    "4H",
    "1H",
    "30M",
    "15M",
    "5M",
    "1M"
  ];

  const shots = [];

  for (const tf of tfs) {
    const img = await capture(symbol, tf);
    shots.push(img);
  }

  const rows = [];

  for (let i = 0; i < shots.length; i += 4) {
    const row = await sharp({
      create: {
        width: WIDTH * 4,
        height: HEIGHT,
        channels: 3,
        background: "#000"
      }
    })
      .composite([
        { input: shots[i], left: 0, top: 0 },
        { input: shots[i + 1], left: WIDTH, top: 0 },
        { input: shots[i + 2], left: WIDTH * 2, top: 0 },
        { input: shots[i + 3], left: WIDTH * 3, top: 0 }
      ])
      .png()
      .toBuffer();

    rows.push(row);
  }

  const final = await sharp({
    create: {
      width: WIDTH * 4,
      height: HEIGHT * 2,
      channels: 3,
      background: "#000"
    }
  })
    .composite([
      { input: rows[0], left: 0, top: 0 },
      { input: rows[1], left: 0, top: HEIGHT }
    ])
    .png()
    .toBuffer();

  return final;
}

module.exports = {
  buildGrid
};
