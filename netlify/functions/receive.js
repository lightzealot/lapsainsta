const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');

async function downloadToFile(url, destPath) {
  let resp;
  try {
    resp = await axios.get(url, { responseType: 'stream', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch (err) {
    const status = err.response && err.response.status;
    const data = err.response && err.response.data;
    throw new Error(`Failed to download ${url} — status: ${status || 'N/A'} — ${err.message} ${data ? JSON.stringify(data).slice(0,200) : ''}`);
  }
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

  // Support two modes:
  // 1) Direct API POST { instagram_url, telegram_chat_id }
  // 2) Telegram webhook payload (update) -> extract message.text and chat.id
  let instagram_url = body.instagram_url;
  let telegram_chat_id = body.telegram_chat_id;

  if (!instagram_url && body.message && body.message.text) {
    const text = body.message.text;
    const urlMatch = text.match(/https?:\/\/[^\s]+instagram\.com[^\s]*/i) || text.match(/https?:\/\/[^\s]*instagr\.am[^\s]*/i);
    if (urlMatch) instagram_url = urlMatch[0];
    telegram_chat_id = (body.message.chat && body.message.chat.id) || (body.message.from && body.message.from.id);
  }

  if (!instagram_url || !telegram_chat_id) {
    return { statusCode: 400, body: 'Missing instagram_url or telegram_chat_id' };
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TELEGRAM_BOT_TOKEN) {
    return { statusCode: 500, body: 'Telegram token not configured in environment' };
  }

  try {
    // helper to call telegram and provide better errors
    async function tg(method, payload) {
      try {
        const res = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, payload, { timeout: 20000 });
        return res;
      } catch (e) {
        const status = e.response && e.response.status;
        const body = e.response && e.response.data;
        const hint = status === 404 ? '404 from Telegram — likely invalid bot token' : (status === 401 ? '401 Unauthorized from Telegram — check token' : `status ${status}`);
        const msg = `Telegram API error (${hint}): ${e.message} ${body ? JSON.stringify(body).slice(0,200) : ''}`;
        // log for Netlify
        console.error(msg);
        throw new Error(msg);
      }
    }

    // Notify: starting
    await tg('sendMessage', { chat_id: telegram_chat_id, text: 'Recibido enlace de Instagram. Iniciando descarga...' });

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

    // Always download first, send progress messages to chat
    const tmpFile = path.join(os.tmpdir(), `insta_video_${Date.now()}.mp4`);
    await tg('sendMessage', { chat_id: telegram_chat_id, text: 'Extrayendo URL de video pública...' });

    await downloadToFile(videoUrl, tmpFile);

    // Notify downloaded
    await tg('sendMessage', { chat_id: telegram_chat_id, text: 'Descarga completada. Subiendo a Telegram...' });

    const form = new FormData();
    form.append('chat_id', telegram_chat_id);
    form.append('video', fs.createReadStream(tmpFile));

    let sendResp;
    try {
      sendResp = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
        form,
        { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 60000 }
      );
    } catch (e) {
      const status = e.response && e.response.status;
      const body = e.response && e.response.data;
      throw new Error(`Failed to send video to Telegram — status: ${status || 'N/A'} — ${e.message} ${body ? JSON.stringify(body).slice(0,200) : ''}`);
    }

    // cleanup
    try { fs.unlinkSync(tmpFile); } catch (e) {}

    // Notify success
    await tg('sendMessage', { chat_id: telegram_chat_id, text: 'Video enviado correctamente ✅' });

    return { statusCode: 200, body: JSON.stringify({ ok: true, method: 'download-and-upload', telegram: sendResp.data }) };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error('Handler error:', message);
    // Try to notify the chat about the error
    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: telegram_chat_id,
        text: `Error procesando el enlace: ${message}`
      });
    } catch (notifyErr) {
      console.error('Failed to notify chat about the error:', notifyErr && notifyErr.message);
    }
    return { statusCode: 500, body: `Error interno: ${message}` };
  }
};
