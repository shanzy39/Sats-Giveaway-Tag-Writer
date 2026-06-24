"use strict";
/* =========================================================================
   Dynamic Unbank Lightning Voucher page logic.
   Reads ?lnurl=<bech32 LNURL> (required) and optional ?amt=<sats> from the
   page URL, then builds the QR + per-wallet deep links on the fly.
   The bech32 decoder and QR encoder below are the same self-contained
   modules used by the Sats Giveaway Tag Writer (index.html) - no external
   libraries, so the page works offline / on GitHub Pages.
   ========================================================================= */

/* ---------------- bech32 (LNURL uses classic bech32, not bech32m) -------- */
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Polymod(values){
  const GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  let chk=1;
  for(const v of values){
    const b=chk>>>25;
    chk=((chk&0x1ffffff)<<5)^v;
    for(let i=0;i<5;i++) if((b>>>i)&1) chk^=GEN[i];
  }
  return chk>>>0;
}
function bech32HrpExpand(hrp){
  const out=[];
  for(let i=0;i<hrp.length;i++) out.push(hrp.charCodeAt(i)>>>5);
  out.push(0);
  for(let i=0;i<hrp.length;i++) out.push(hrp.charCodeAt(i)&31);
  return out;
}
function bech32Decode(str){
  str=str.toLowerCase();
  const pos=str.lastIndexOf("1");
  if(pos<1||pos+7>str.length) throw new Error("not a valid LNURL (bech32 structure)");
  const hrp=str.slice(0,pos);
  const data=[];
  for(let i=pos+1;i<str.length;i++){
    const d=B32.indexOf(str[i]);
    if(d===-1) throw new Error("invalid character in LNURL");
    data.push(d);
  }
  const chk=bech32Polymod(bech32HrpExpand(hrp).concat(data));
  if(chk!==1) throw new Error("LNURL checksum failed (link may be truncated)");
  return {hrp,data:data.slice(0,data.length-6)};
}
function convert5to8(data){
  let acc=0,bits=0;const out=[];
  for(const v of data){
    acc=(acc<<5)|v;bits+=5;
    while(bits>=8){bits-=8;out.push((acc>>>bits)&0xff);}
  }
  return out;
}
/* Decode an LNURL string to its target URL. */
function lnurlToUrl(s){
  const {hrp,data}=bech32Decode(s);
  if(hrp!=="lnurl") throw new Error('expected an "lnurl" prefix');
  const bytes=convert5to8(data);
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/* ----------------------------- QR generator ------------------------------
   Compact byte-mode encoder. Algorithm after Project Nayuki (MIT).
   Supports versions 1-13 at ECC level L or M (enough for any LNURL).      */
const QR=(function(){
  const ECC={
    L:{cw:[0,7,10,15,20,26,18,20,24,30,18,20,24,26],nb:[0,1,1,1,1,1,2,2,2,2,4,4,4,4]},
    M:{cw:[0,10,16,26,18,24,16,18,22,22,26,30,22,22],nb:[0,1,1,1,2,2,4,4,4,5,5,5,8,9]}
  };
  const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
  (function(){let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}for(let i=255;i<512;i++)EXP[i]=EXP[i-255];})();
  const gmul=(a,b)=>(a===0||b===0)?0:EXP[LOG[a]+LOG[b]];

  function rawModules(ver){
    let r=(16*ver+128)*ver+64;
    if(ver>=2){const na=Math.floor(ver/7)+2;r-=(25*na-10)*na-55;if(ver>=7)r-=36;}
    return r;
  }
  function rsDivisor(deg){
    const res=new Uint8Array(deg);res[deg-1]=1;
    let root=1;
    for(let i=0;i<deg;i++){
      for(let j=0;j<deg;j++){
        res[j]=gmul(res[j],root);
        if(j+1<deg) res[j]^=res[j+1];
      }
      root=gmul(root,2);
    }
    return res;
  }
  function rsRemainder(data,div){
    const res=new Uint8Array(div.length);
    for(const b of data){
      const factor=b^res[0];
      res.copyWithin(0,1);res[res.length-1]=0;
      for(let i=0;i<div.length;i++) res[i]^=gmul(div[i],factor);
    }
    return res;
  }

  function chooseVersion(len,ecl){
    for(let v=1;v<=13;v++){
      const cw=Math.floor(rawModules(v)/8);
      const totalEcc=ECC[ecl].cw[v]*ECC[ecl].nb[v];
      const dataCw=cw-totalEcc;
      const cci=v<=9?8:16;
      const need=4+cci+8*len;
      if(need+4<=dataCw*8) return {ver:v,dataCw,cw};
    }
    return null;
  }

  function encode(text){
    const bytes=new TextEncoder().encode(text);
    let pick=null,ecl=null;
    for(const lv of ["M","L"]){const p=chooseVersion(bytes.length,lv);if(p){pick=p;ecl=lv;break;}}
    if(!pick) throw new Error("link too long for a single QR (shorten the LNURL)");
    const {ver,dataCw}=pick;
    const size=ver*4+17;

    const bb=[];
    const put=(val,len)=>{for(let i=len-1;i>=0;i--)bb.push((val>>>i)&1);};
    put(4,4);
    put(bytes.length, ver<=9?8:16);
    for(const b of bytes) put(b,8);
    const cap=dataCw*8;
    for(let i=0;i<4&&bb.length<cap;i++) bb.push(0);
    while(bb.length%8!==0) bb.push(0);
    const dataBytes=[];
    for(let i=0;i<bb.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bb[i+j];dataBytes.push(b);}
    for(let pad=0xec;dataBytes.length<dataCw;pad^=0xec^0x11) dataBytes.push(pad);

    const numBlocks=ECC[ecl].nb[ver];
    const eccLen=ECC[ecl].cw[ver];
    const shortLen=Math.floor(dataCw/numBlocks);
    const numLong=dataCw%numBlocks;
    const div=rsDivisor(eccLen);
    const dataBlocks=[],eccBlocks=[];
    let off=0;
    for(let b=0;b<numBlocks;b++){
      const dlen=shortLen+(b>=numBlocks-numLong?1:0);
      const blk=dataBytes.slice(off,off+dlen);off+=dlen;
      dataBlocks.push(blk);
      eccBlocks.push(rsRemainder(blk,div));
    }
    const maxData=shortLen+(numLong>0?1:0);
    const result=[];
    for(let i=0;i<maxData;i++) for(let b=0;b<numBlocks;b++) if(i<dataBlocks[b].length) result.push(dataBlocks[b][i]);
    for(let i=0;i<eccLen;i++) for(let b=0;b<numBlocks;b++) result.push(eccBlocks[b][i]);

    const mod=Array.from({length:size},()=>new Int8Array(size).fill(-1));
    const setFn=(x,y,v)=>{mod[y][x]=v?1:0;};
    function finder(cx,cy){
      for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++){
        const x=cx+dx,y=cy+dy;if(x<0||x>=size||y<0||y>=size)continue;
        const d=Math.max(Math.abs(dx-3),Math.abs(dy-3));
        setFn(x,y,(d!==2&&d!==4));
      }
    }
    finder(0,0);finder(size-7,0);finder(0,size-7);
    for(let i=0;i<size;i++){if(mod[6][i]<0)setFn(i,6,i%2===0);if(mod[i][6]<0)setFn(6,i,i%2===0);}
    function alignPos(v){
      if(v===1)return[];
      const n=Math.floor(v/7)+2;const last=size-7;
      if(v===1)return[];
      const step=(v===2)?0:Math.ceil((last-6)/(n-1)/2)*2;
      const pos=[6];for(let i=last;pos.length<n;i-=step)pos.unshift(i);return pos;
    }
    const ap=alignPos(ver);
    for(const ax of ap)for(const ay of ap){
      if((ax<8&&ay<8)||(ax<8&&ay>size-9)||(ax>size-9&&ay<8))continue;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const d=Math.max(Math.abs(dx),Math.abs(dy));setFn(ax+dx,ay+dy,d!==1);
      }
    }
    setFn(8,size-8,true);
    const reserve=(x,y)=>{if(mod[y][x]<0)mod[y][x]=0;};
    for(let i=0;i<9;i++){reserve(i,8);reserve(8,i);}
    for(let i=0;i<8;i++){reserve(size-1-i,8);reserve(8,size-1-i);}
    if(ver>=7){
      for(let i=0;i<6;i++)for(let j=0;j<3;j++){reserve(size-11+j,i);reserve(i,size-11+j);}
    }

    let di=0;
    const getBit=(idx)=>(result[idx>>>3]>>>(7-(idx&7)))&1;
    for(let col=size-1;col>0;col-=2){
      if(col===6)col--;
      for(let r=0;r<size;r++){
        for(let c=0;c<2;c++){
          const x=col-c;
          const upward=((col+1)&2)===0;
          const y=upward?size-1-r:r;
          if(mod[y][x]<0){
            let bit=di<result.length*8?getBit(di):0;di++;
            mod[y][x]=bit;
          }
        }
      }
    }

    const maskFns=[
      (x,y)=>((x+y)%2===0),(x,y)=>(y%2===0),(x,y)=>(x%3===0),
      (x,y)=>((x+y)%3===0),(x,y)=>((Math.floor(y/2)+Math.floor(x/3))%2===0),
      (x,y)=>(((x*y)%2)+((x*y)%3)===0),(x,y)=>((((x*y)%2)+((x*y)%3))%2===0),
      (x,y)=>((((x+y)%2)+((x*y)%3))%2===0)
    ];
    const isData=Array.from({length:size},()=>new Uint8Array(size));
    const fmask=buildFunctionMap(size,ver,ap);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)isData[y][x]=fmask[y][x]?0:1;

    function applyFmtAndMask(maskNo){
      const m=mod.map(r=>Int8Array.from(r));
      for(let y=0;y<size;y++)for(let x=0;x<size;x++)
        if(isData[y][x]&&maskFns[maskNo](x,y)) m[y][x]^=1;
      drawFormat(m,size,ecl,maskNo);
      if(ver>=7) drawVersion(m,size,ver);
      return m;
    }
    let best=null,bestPen=1e9,bestNo=0;
    for(let n=0;n<8;n++){const m=applyFmtAndMask(n);const p=penalty(m,size);if(p<bestPen){bestPen=p;best=m;bestNo=n;}}
    return best;
  }

  function buildFunctionMap(size,ver,ap){
    const f=Array.from({length:size},()=>new Uint8Array(size));
    const mark=(x,y)=>{if(x>=0&&x<size&&y>=0&&y<size)f[y][x]=1;};
    function fnd(cx,cy){for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++)mark(cx+dx,cy+dy);}
    fnd(0,0);fnd(size-7,0);fnd(0,size-7);
    for(let i=0;i<size;i++){mark(i,6);mark(6,i);}
    for(const ax of ap)for(const ay of ap){
      if((ax<8&&ay<8)||(ax<8&&ay>size-9)||(ax>size-9&&ay<8))continue;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)mark(ax+dx,ay+dy);
    }
    for(let i=0;i<9;i++){mark(i,8);mark(8,i);}
    for(let i=0;i<8;i++){mark(size-1-i,8);mark(8,size-1-i);}
    mark(8,size-8);
    if(ver>=7){for(let i=0;i<6;i++)for(let j=0;j<3;j++){mark(size-11+j,i);mark(i,size-11+j);}}
    return f;
  }
  function drawFormat(m,size,ecl,mask){
    const eclBits={M:0,L:1}[ecl];
    let data=(eclBits<<3)|mask;
    let rem=data;
    for(let i=0;i<10;i++)rem=(rem<<1)^(((rem>>>9)&1)*0x537);
    const bits=((data<<10)|rem)^0x5412;
    const set=(x,y,v)=>{m[y][x]=v;};
    for(let i=0;i<=5;i++)set(8,i,(bits>>>i)&1);
    set(8,7,(bits>>>6)&1);set(8,8,(bits>>>7)&1);set(7,8,(bits>>>8)&1);
    for(let i=9;i<15;i++)set(14-i,8,(bits>>>i)&1);
    for(let i=0;i<8;i++)set(size-1-i,8,(bits>>>i)&1);
    for(let i=8;i<15;i++)set(8,size-15+i,(bits>>>i)&1);
    set(8,size-8,1);
  }
  function drawVersion(m,size,ver){
    let rem=ver;
    for(let i=0;i<12;i++)rem=(rem<<1)^(((rem>>>11)&1)*0x1f25);
    const bits=(ver<<12)|rem;
    for(let i=0;i<18;i++){
      const b=(bits>>>i)&1;const a=size-11+(i%3),c=Math.floor(i/3);
      m[c][a]=b;m[a][c]=b;
    }
  }
  function penalty(m,size){
    let p=0;
    for(let y=0;y<size;y++){let rc=1;for(let x=1;x<size;x++){if(m[y][x]===m[y][x-1]){rc++;if(rc===5)p+=3;else if(rc>5)p++;}else rc=1;}}
    for(let x=0;x<size;x++){let rc=1;for(let y=1;y<size;y++){if(m[y][x]===m[y-1][x]){rc++;if(rc===5)p+=3;else if(rc>5)p++;}else rc=1;}}
    for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const v=m[y][x];if(v===m[y][x+1]&&v===m[y+1][x]&&v===m[y+1][x+1])p+=3;}
    const pat=[1,0,1,1,1,0,1];
    function look(arr){for(let i=0;i+11<=arr.length;i++){let ok=true;for(let k=0;k<7;k++)if(arr[i+k]!==pat[k]){ok=false;break;}if(ok){let z1=true;for(let k=7;k<11;k++)if(arr[i+k]!==0){z1=false;break;}if(z1)p+=40;}let ok2=true;for(let k=0;k<4;k++)if(arr[i+k]!==0){ok2=false;break;}if(ok2){let g=true;for(let k=0;k<7;k++)if(arr[i+4+k]!==pat[k]){g=false;break;}if(g)p+=40;}}}
    for(let y=0;y<size;y++){const row=[];for(let x=0;x<size;x++)row.push(m[y][x]);look(row);}
    for(let x=0;x<size;x++){const col=[];for(let y=0;y<size;y++)col.push(m[y][x]);look(col);}
    let dark=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++)dark+=m[y][x];
    const pct=dark*100/(size*size);const k=Math.floor(Math.abs(pct-50)/5);p+=k*10;
    return p;
  }

  function render(matrix,canvas,scale,quiet){
    scale=scale||6;quiet=quiet==null?4:quiet;
    const size=matrix.length;const dim=(size+quiet*2)*scale;
    canvas.width=dim;canvas.height=dim;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,dim,dim);
    ctx.fillStyle="#000";
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)
      if(matrix[y][x])ctx.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);
  }
  return {encode,render};
})();

/* ----------------------------- page wiring ------------------------------- */
(function(){
  const $=(id)=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  let lnurl=(params.get("lnurl")||"").trim();
  const amtParam=(params.get("amt")||"").trim();

  // Tolerate a "lightning:" scheme prefix on the param, then normalise.
  lnurl=lnurl.replace(/^lightning:/i,"").trim();
  const lnurlUpper=lnurl.toUpperCase();

  // ---- Guard: no/invalid LNURL ----
  if(!lnurl || !/^lnurl1[0-9a-z]+$/i.test(lnurl)){
    showMissing();
    return;
  }

  // ---- QR (encode the bare, uppercase LNURL) ----
  try{
    const matrix=QR.encode(lnurlUpper);
    QR.render(matrix,$("qrCanvas"),6,2);
  }catch(e){
    console.error("QR render failed:",e);
  }

  // ---- Wallet deep links ----
  setHref("btnWos","walletofsatoshi:"+lnurlUpper);
  setHref("btnZeus","zeusln:lightning:"+lnurlUpper);
  setHref("btnPhoenix","phoenix:lightning:"+lnurlUpper);
  setHref("btnGeneric","lightning:"+lnurlUpper);

  // ---- Copy LNURL ----
  const field=$("lnurlField");
  if(field) field.value=lnurlUpper;
  wireCopy();

  // ---- Speed reveal (no URL scheme; show scan instructions) ----
  wireSpeed();

  // ---- Amount: show ?amt immediately, then live-fetch the real value ----
  if(amtParam && /^\d+$/.test(amtParam)) setAmount(amtParam);
  fetchAmount();

  /* ------------------------------------------------------------------ */
  function setHref(id,href){const el=$(id);if(el)el.setAttribute("href",href);}
  function setAmount(n){const el=$("amtNum");if(el)el.textContent=String(n);}

  function showMissing(){
    const card=$("card");
    if(card) card.classList.add("missing");
    const amt=$("amount"); if(amt) amt.style.display="none";
    const qr=$("qrWrap");  if(qr)  qr.style.display="none";
    const h=document.querySelector("h1"); if(h) h.textContent="No voucher specified";
    // Hide interactive controls that have no target.
    ["copyBtn","copyHint","lnurlText","speedCallout","btnWos","btnZeus","btnPhoenix","btnGeneric"]
      .forEach(id=>{const el=$(id);if(el)el.style.display="none";});
    document.querySelectorAll('[data-wallet="speed"]').forEach(el=>el.style.display="none");
    const cap=document.querySelector(".qr-cap");
    if(cap) cap.innerHTML="Open this page with a <b>?lnurl=</b> voucher link to claim sats.";
  }

  function wireCopy(){
    const btn=$("copyBtn");
    if(!btn) return;
    const label=btn.querySelector(".copy-label");
    btn.addEventListener("click",function(ev){
      ev.preventDefault();
      const text=lnurlUpper;
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(()=>flash(true)).catch(()=>fallback(text));
      }else{
        fallback(text);
      }
    });
    function fallback(text){
      const f=$("lnurlField");
      const box=$("lnurlText");
      try{
        if(box) box.hidden=false;
        if(f){f.focus();f.select();f.setSelectionRange(0,text.length);}
        const ok=document.execCommand && document.execCommand("copy");
        flash(!!ok);
      }catch(e){
        if(box) box.hidden=false;
        flash(false);
      }
    }
    function flash(ok){
      if(label) label.textContent=ok?"Copied!":"Long-press below to copy";
      btn.classList.toggle("copied",ok);
      if(!ok){const box=$("lnurlText");if(box)box.hidden=false;}
      setTimeout(()=>{
        if(label) label.textContent="Copy LNURL";
        btn.classList.remove("copied");
      },2200);
    }
  }

  function wireSpeed(){
    const speedBtn=document.querySelector('[data-wallet="speed"]');
    const callout=$("speedCallout");
    const qr=$("qrWrap");
    if(!speedBtn) return;
    speedBtn.addEventListener("click",function(ev){
      ev.preventDefault();
      if(callout) callout.style.display="block";
      if(qr){qr.classList.remove("flash");void qr.offsetWidth;qr.classList.add("flash");}
      if(qr) qr.scrollIntoView({behavior:"smooth",block:"center"});
    });
  }

  function fetchAmount(){
    let url;
    try{ url=lnurlToUrl(lnurlUpper); }
    catch(e){ return; }
    fetch(url,{method:"GET"})
      .then(r=>r.json())
      .then(j=>{
        if(j && typeof j.maxWithdrawable==="number"){
          const sats=Math.floor(j.maxWithdrawable/1000);
          setAmount(sats);
        }else if(j && j.status==="ERROR"){
          // Spent / expired link.
          const el=$("amtNum");
          if(el){el.textContent="—";}
          const cap=document.querySelector(".qr-cap");
          if(cap) cap.innerHTML="This voucher may already be <b>claimed or expired</b>.";
        }
      })
      .catch(()=>{ /* tunnel down / CORS: keep ?amt or neutral placeholder */ });
  }
})();
