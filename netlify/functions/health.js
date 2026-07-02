exports.handler = async () => {
  const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, env: { telegram_token_configured: hasToken } })
  };
};
