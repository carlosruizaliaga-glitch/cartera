// Edge Function "ct-notify": manda a Telegram el resumen que calcula la app.
// Comprueba el código de la app (igual que ct-market) y usa los secretos TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID del proyecto.
// No guarda nada: solo reenvía el texto.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim() || 'edge';
    const { data: ok, error } = await sb.rpc('ct_check', { p_secret: body.secret ?? '', p_ip: ip });
    if (error) return json({ error: String(error.message || error) }, 429);
    if (!ok) return json({ error: 'bad_secret' }, 401);

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN'), chat = Deno.env.get('TELEGRAM_CHAT_ID');
    if (body.action === 'status') return json({ ok: true, configured: !!(token && chat) });
    if (!token || !chat) return json({ error: 'missing_telegram' });

    const text = typeof body.text === 'string' ? body.text.slice(0, 3800) : '';
    if (!text.trim()) return json({ error: 'empty' });
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) return json({ error: 'telegram_' + r.status });
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
