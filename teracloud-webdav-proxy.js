/**
 * Cloudflare Worker - 反代 toi.teracloud.jp/dav
 * 
 * 核心策略（修正版）：
 * 不在服务端跟随重定向，而是将 302 Location 头中的原域名替换为 Worker 域名后
 * 返回给客户端。WebDAV 客户端（如 nautilus/GVfs/rclone）能够正确处理重定向，
 * 前提是重定向目标指向 Worker 而非原站。
 * 
 * 之前版本的问题：在服务端跟随 301/302 时将请求方法改为了 GET，
 * 导致 PROPFIND 请求变成 GET，上游返回普通页面而非 WebDAV 响应，
 * nautilus 因此判定"不是启用了WebDAV的共享"。
 */

const UPSTREAM_ORIGIN = 'https://xxxx.teracloud.jp'; //这里填写infinicloud后台给你的地址（不包含路径）

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const workerOrigin = url.origin;
  const upstreamHost = new URL(UPSTREAM_ORIGIN).host;

  // === 处理 CORS 预检请求 ===
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, PATCH, HEAD, OPTIONS, PROPFIND, MKCOL, COPY, MOVE, LOCK, UNLOCK, PROPPATCH',
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
        'Access-Control-Expose-Headers': '*',
        'Access-Control-Max-Age': '86400',
        // WebDAV 需要的额外 CORS 头
        'DAV': '1, 2, 3', // 声明支持 WebDAV 版本
      },
    });
  }

  // === 构建上游请求 URL ===
  const upstreamUrl = UPSTREAM_ORIGIN + url.pathname + url.search;

  // === 构建上游请求头 ===
  const headers = new Headers(request.headers);
  headers.set('Host', upstreamHost);

  // 关键：替换 Origin 和 Referer，避免上游服务器因来源校验而触发 302
  if (headers.has('Origin')) {
    headers.set('Origin', UPSTREAM_ORIGIN);
  }
  if (headers.has('Referer')) {
    headers.set('Referer', headers.get('Referer').replace(workerOrigin, UPSTREAM_ORIGIN));
  }
  if (headers.has('Authorization')) {
    // 保留 Authorization 头，WebDAV 认证需要
  }

  // 移除可能暴露代理身份的头
  headers.delete('X-Forwarded-For');
  headers.delete('X-Forwarded-Proto');
  headers.delete('X-Forwarded-Host');
  headers.delete('CF-Connecting-IP');
  headers.delete('CF-IPCountry');
  headers.delete('CF-RAY');
  headers.delete('CF-Visitor');
  headers.delete('CF-Worker');
  headers.delete('Cache-Key');

  // === 构建上游请求 ===
  const init = {
    method: request.method,
    headers: headers,
    redirect: 'manual', // 核心：不自动跟随重定向，由我们处理
  };

  // GET/HEAD 请求不应携带 body
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // 对于带 body 的请求（如 PUT、带 body 的 PROPFIND），需要 duplex 支持
    if (request.method === 'PUT' || request.method === 'PROPFIND' || request.method === 'PROPPATCH') {
      init.duplex = 'half';
    }
  }

  // === 发送请求到上游 ===
  let response;
  try {
    response = await fetch(new Request(upstreamUrl, init));
  } catch (err) {
    return new Response(`Upstream request failed: ${err.message}`, { status: 502 });
  }

  // === 处理重定向响应 ===
  // 核心策略：不在服务端跟随重定向，而是改写 Location 头后返回给客户端
  // 这样 WebDAV 客户端会以正确的方法（如 PROPFIND）重新请求新路径
  if (response.status >= 300 && response.status < 400) {
    let location = response.headers.get('Location');
    if (location) {
      // 将 Location 中的上游域名替换为 Worker 域名
      let newLocation = rewriteLocation(location, workerOrigin, upstreamHost);

      const respHeaders = new Headers(response.headers);
      respHeaders.set('Location', newLocation);

      // 添加 CORS 支持
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Expose-Headers', '*');

      // 对 301/302/303：WebDAV 规范要求客户端保持原方法（对 302/303 则按 HTTP 规范改为 GET）
      // 但大多数 WebDAV 客户端（包括 GVfs）对 302 会用原方法重试
      // 如果希望强制客户端用原方法重试，可将 302 改为 307（临时重定向，保持方法不变）
      if (response.status === 301 || response.status === 302 || response.status === 303) {
        // 改为 307 Temporary Redirect，确保客户端用完全相同的方法和 body 重试
        return new Response(null, {
          status: 307,
          statusText: 'Temporary Redirect',
          headers: respHeaders,
        });
      }

      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    }
  }

  // === 处理普通响应 ===
  const respHeaders = new Headers(response.headers);

  // 移除安全策略头
  respHeaders.delete('Content-Security-Policy');
  respHeaders.delete('Content-Security-Policy-Report-Only');
  respHeaders.delete('Strict-Transport-Security');

  // 添加 CORS 支持
  respHeaders.set('Access-Control-Allow-Origin', '*');
  respHeaders.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, PATCH, HEAD, OPTIONS, PROPFIND, MKCOL, COPY, MOVE, LOCK, UNLOCK, PROPPATCH');
  respHeaders.set('Access-Control-Expose-Headers', '*');

  // 处理 Set-Cookie 中的 domain
  const origCookies = [];
  for (const [key, val] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      origCookies.push(val);
    }
  }
  if (origCookies.length > 0) {
    respHeaders.delete('Set-Cookie');
    for (const cookie of origCookies) {
      let newCookie = cookie.replace(
        new RegExp(`domain=\\.?${escapeRegex(upstreamHost)}`, 'gi'),
        `domain=${new URL(workerOrigin).host}`
      );
      if (workerOrigin.startsWith('http://')) {
        newCookie = newCookie.replace(/;\s*Secure/gi, '');
      }
      respHeaders.append('Set-Cookie', newCookie);
    }
  }

  // === 处理响应体中的域名替换 ===
  const contentType = response.headers.get('Content-Type') || '';
  const isTextContent = /text\/|xml|json|javascript|css/i.test(contentType);

  if (isTextContent && response.status !== 204 && response.body) {
    try {
      let body = await response.text();

      // 替换所有出现的上游域名为 Worker 域名
      body = body
        .replace(new RegExp(`https?://${escapeRegex(upstreamHost)}`, 'g'), workerOrigin)
        .replace(new RegExp(escapeRegex(upstreamHost), 'g'), new URL(workerOrigin).host);

      // 更新 Content-Length（因为域名长度可能变了）
      respHeaders.delete('Content-Length');
      respHeaders.delete('Content-Encoding');

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    } catch (e) {
      // text() 读取失败则透传原始 body
    }
  }

  // 非 text 内容（文件等）直接透传
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
  });
}

/**
 * 重写 Location 头，将上游域名替换为 Worker 域名
 * 
 * 支持以下格式：
 * - 绝对URL：https://toi.teracloud.jp/dav/ -> https://worker.dev/dav/
 * - 相对URL：/dav/ -> /dav/
 * - 协议相对URL：//toi.teracloud.jp/dav/ -> //worker.dev/dav/
 */
function rewriteLocation(location, workerOrigin, upstreamHost) {
  const workerHost = new URL(workerOrigin).host;

  // 协议相对URL：//toi.teracloud.jp/...
  if (location.startsWith('//')) {
    return location.replace(`//${upstreamHost}/`, `//${workerHost}/`);
  }

  // 绝对URL：https://toi.teracloud.jp/...
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return location
      .replace(new RegExp(`https?://${escapeRegex(upstreamHost)}`, 'g'), workerOrigin);
  }

  // 相对URL：/dav/... — 不需要改写域名，客户端会自动拼接
  return location;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
