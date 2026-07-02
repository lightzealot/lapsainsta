const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');

async function downloadToFile(url, destPath) {
  const resp = await axios.get(url, { responseType: 'stream', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const writer = fs.createWriteStream(destPath);
  return new Promise((resolve, reject) => {
    resp.data.pipe(writer);
    let error = null;
    writer.on('error', (err) => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on('close', () => {
      if (!error) resolve(destPath);
    });
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { instagram_url, telegram_chat_id } = body;
  if (!instagram_url || !telegram_chat_id) {
    return { statusCode: 400, body: 'Missing instagram_url or telegram_chat_id' };
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) {
    return { statusCode: 500, body: 'Telegram token not configured in environment' };
  }

  try {
    const resp = await axios.get(instagram_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NetlifyFunction/1.0)'
      },
      timeout: 15000
    });

    const html = resp.data || '';

    // Try common places where a direct video URL may appear
    let match = html.match(/property=["']og:video["'] content=["']([^"']+)["']/i);
    if (!match) match = html.match(/property=["']og:video:secure_url["'] content=["']([^"']+)["']/i);
    if (!match) match = html.match(/"video_url":"([^"]+)"/i);
    if (!match) match = html.match(/"display_url":"([^"]+)"/i);

    if (!match) {
      return { statusCode: 400, body: 'No se encontró un video público en la URL proporcionada' };
    }

    let videoUrl = match[1];
    videoUrl = videoUrl.replace(/\\\//g, '/').replace(/&amp;/g, '&');

    // First try: let Telegram fetch the remote URL
    try {
      const tgResp = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
        {
          chat_id: telegram_chat_id,
          video: videoUrl
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
      );

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, method: 'url', telegram: tgResp.data })
      };
    } catch (outerErr) {
      // If sending by URL fails (e.g., Telegram can't fetch), download and send file
      try {
        const tmpFile = path.join(os.tmpdir(), `insta_video_${Date.now()}.mp4`);
        await downloadToFile(videoUrl, tmpFile);

        const form = new FormData();
        form.append('chat_id', telegram_chat_id);
        form.append('video', fs.createReadStream(tmpFile));

        const sendResp = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
          form,
          { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 60000 }
        );

        // cleanup
        try { fs.unlinkSync(tmpFile); } catch (e) {}

        return { statusCode: 200, body: JSON.stringify({ ok: true, method: 'upload', telegram: sendResp.data }) };
      } catch (innerErr) {
        const message = innerErr && innerErr.message ? innerErr.message : String(innerErr);
        return { statusCode: 500, body: `Error enviando video a Telegram: ${message}` };
      }
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return { statusCode: 500, body: `Error interno: ${message}` };
  }
};
