const ORIGIN = 'https://folio-pdf.clark719664.chatgpt.site';
const LIMIT = 25 * 1024 * 1024 + 65536;
function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {status:response.status, headers});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== ORIGIN) return new Response('Origin not allowed', {status:403});
    const allowed = (request.method === 'POST' && url.pathname === '/convert') || (request.method === 'GET' && ['/health','/formats'].includes(url.pathname));
    if (request.method === 'OPTIONS' && url.pathname === '/convert') return cors(new Response(null, {status:204}));
    if (!allowed || url.search) return cors(new Response('Not found', {status:404}));
    if (Number(request.headers.get('Content-Length') || 0) > LIMIT) return cors(Response.json({detail:'File exceeds 25 MB.'},{status:413}));
    const headers = new Headers();
    for (const name of ['Content-Type','Content-Length']) if (request.headers.has(name)) headers.set(name,request.headers.get(name));
    // Cloudflare supplies the real visitor header. Arbitrary client forwarding headers are discarded.
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('CF-Connecting-IP',ip);
    if (origin) headers.set('Origin',origin);
    try {
      const response = await env.CONVERTER.fetch(new Request('http://127.0.0.1:8091'+url.pathname,{method:request.method,headers,body:request.method==='POST'?request.body:undefined,redirect:'manual'}));
      if (response.status >= 300 && response.status < 400) throw new Error('Unexpected upstream redirect');
      return cors(response);
    } catch (error) {
      console.error('Conversion upstream failure:', error instanceof Error ? error.message : 'unknown');
      if (url.pathname === '/health') {
        const message = error instanceof Error ? error.message : '';
        const code = message.match(/(?:ProxyError:\s*|proxy error:\s*)([a-z_]+)/i)?.[1] || 'upstream_error';
        return cors(Response.json({status:'unavailable',code},{status:503}));
      }
      return cors(Response.json({detail:'Conversion service is unavailable. Try again shortly.'},{status:503,headers:{'Retry-After':'15'}}));
    }
  }
};
