const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

function readTokenFromEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const m = content.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
  return m ? m[1].trim() : null;
}

async function extractWithPuppeteer(url) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Try to find a video element or meta tags
    const videoUrl = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v && v.src) return v.src;
      const m = document.querySelector('meta[property="og:video"]');
      if (m && m.content) return m.content;
      const m2 = document.querySelector('meta[property="og:video:secure_url"]');
      if (m2 && m2.content) return m2.content;
      // look for javascript objects
      const scripts = Array.from(document.scripts).map(s => s.textContent).join('\n');
      const rx = /"video_url":"([^"]+)"/i;
      const mm = scripts.match(rx);
      if (mm) return mm[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
      return null;
    });

    return videoUrl;
  } finally {
    await browser.close();
  }
}

async function downloadToFile(url, destPath) {
  const resp = await axios.get(url, { responseType: 'stream', timeout: 60000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const writer = fs.createWriteStream(destPath);
  return new Promise((resolve, reject) => {
    resp.data.pipe(writer);
    writer.on('error', reject);
    writer.on('close', () => resolve(destPath));
  });
}

async function sendVideo(token, chatId, filePath) {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('video', fs.createReadStream(filePath));
  const res = await axios.post(`https://api.telegram.org/bot${token}/sendVideo`, form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 });
  return res.data;
}

async function main(){
  const instaUrl = process.argv[2];
  const chatId = process.argv[3];
  if (!instaUrl || !chatId) {
    console.error('Uso: node scripts/send_instagram_puppeteer.js <INSTAGRAM_URL> <CHAT_ID>');
    process.exit(2);
  }

  const token = readTokenFromEnvFile(path.join(__dirname, '..', '.env')) || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.error('No TELEGRAM_BOT_TOKEN'); process.exit(2); }

  try {
    console.log('Launching headless browser and extracting video URL...');
    const videoUrl = await extractWithPuppeteer(instaUrl);
    if (!videoUrl) throw new Error('No se pudo extraer URL de video con Puppeteer');
    console.log('Video URL:', videoUrl);

    const tmp = path.join(os.tmpdir(), `insta_puppeteer_${Date.now()}.mp4`);
    console.log('Downloading to', tmp);
    await downloadToFile(videoUrl, tmp);
    console.log('Uploading to Telegram...');
    const resp = await sendVideo(token, chatId, tmp);
    console.log('Telegram response:', JSON.stringify(resp));
    try { fs.unlinkSync(tmp); } catch (e) {}
  } catch (e) {
    console.error('Error:', e && e.message ? e.message : e);
    if (e.response && e.response.data) console.error('Response data:', JSON.stringify(e.response.data));
    process.exit(1);
  }
}

main();
