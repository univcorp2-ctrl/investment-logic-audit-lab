import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..','dist');
const port=Number(process.env.PORT??4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url??'/',`http://${request.headers.host??'127.0.0.1'}`);
    const pathname=decodeURIComponent(url.pathname);
    let file=normalize(join(root,pathname==='/'?'index.html':pathname));
    if(!file.startsWith(root)){response.writeHead(403);response.end('Forbidden');return;}
    try{const info=await stat(file);if(info.isDirectory())file=join(file,'index.html');}catch{if(!extname(pathname))file=join(root,'index.html');else throw new Error('not found');}
    response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});
    createReadStream(file).pipe(response);
  }catch{response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});response.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`ValueScope test server http://127.0.0.1:${port}`));
