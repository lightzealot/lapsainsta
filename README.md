# TeleInsta — Netlify function -> Telegram

Pequeña función serverless para Netlify que recibe un `instagram_url` y `telegram_chat_id`, extrae la URL directa del video (cuentas públicas) y lo envía al grupo de Telegram.

IMPORTANTE: nunca pegues tu token en repositorios públicos ni en chats. Usa variables de entorno.

**Variables de entorno**
- `TELEGRAM_BOT_TOKEN`: token del bot de Telegram (configurar en Netlify Site > Site settings > Build & deploy > Environment).

**Estructura**
- `netlify/functions/receive.js` : función HTTP POST.

**Uso / prueba local**
1. Instala dependencias:

```bash
npm install
```

2. Ejecuta con `netlify dev` (requiere la CLI de Netlify):

```bash
npx netlify dev
```

3. Configura la variable localmente antes de ejecutar (opcionalmente crea `.env` y usa `netlify dev` que carga `.env`):

```bash
# export en Linux/macOS
export TELEGRAM_BOT_TOKEN="<tu_token_aqui>"
# en Windows PowerShell
$env:TELEGRAM_BOT_TOKEN = "<tu_token_aqui>"
```

4. Ejemplo de petición HTTP POST:

```bash
curl -X POST http://localhost:8888/.netlify/functions/receive \
  -H "Content-Type: application/json" \
  -d '{"instagram_url":"https://www.instagram.com/p/POST_ID/","telegram_chat_id":"-1001234567890"}'
```

Notas:
- Añade el bot al grupo de Telegram y obtén el `chat_id` (puedes usar `@RawDataBot` o enviar un mensaje y consultar `getUpdates`).
- Esta versión intenta primero enviar la URL a Telegram; si falla, descarga el video en `/tmp` y lo envía como archivo multipart.
