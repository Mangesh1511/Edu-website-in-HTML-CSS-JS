const CACHE='dadas-pr-studio-v45-20260919';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./ai-engine.js'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(request){
  try{
    const fresh=await fetch(request,{cache:'no-store'});
    const cache=await caches.open(CACHE);
    cache.put(request,fresh.clone()).catch(()=>{});
    return fresh;
  }catch{
    return (await caches.match(request)) || (await caches.match('./index.html'));
  }
}

async function staleWhileRevalidate(request){
  const cached=await caches.match(request);
  const fetchPromise=fetch(request).then(async response=>{
    const cache=await caches.open(CACHE);
    cache.put(request,response.clone()).catch(()=>{});
    return response;
  }).catch(()=>null);
  return cached || await fetchPromise || new Response('Offline',{status:503});
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  const aiAsset=url.hostname==='cdn.jsdelivr.net'||url.hostname==='storage.googleapis.com';
  if(url.origin===self.location.origin){
    if(request.mode==='navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/dadas-pr-studio/')){
      event.respondWith(networkFirst(request));
    }else{
      event.respondWith(staleWhileRevalidate(request));
    }
  }else if(aiAsset){
    event.respondWith(staleWhileRevalidate(request));
  }
});