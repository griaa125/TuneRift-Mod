(function(){var w={id:"tweaked-ym-design",directoryName:"tweaked-ym-design",name:"Tweaked YM Design",description:"Слегка улучшены или изменены некоторые моменты дизайна Яндекс Музыки",version:"1.0.0",author:"nelifs",type:"script",image:"",banner:"",libraryLogo:"",tags:["lyrics","player","visual"],dependencies:[],allowedUrls:[],supportedVersions:[]};function b(e,t){if(e&&typeof e=="object"&&!Array.isArray(e)){const s=e;if(typeof s.value<"u")return s.value;if(typeof s.default<"u")return s.default}return typeof e<"u"?e:t}function T(e){return window.pulsesyncApi?.getSettings(e)??{getCurrent:()=>({}),onChange:()=>()=>{}}}function p(e,t,s){return!!b(e[t],s)}function c(e,t,s){const r=b(e[t],s),i=Number(r);return Number.isFinite(i)?i:s}var x='[data-test-id="FULLSCREEN_PLAYER_MODAL"]',J='[data-test-id="SYNC_LYRICS_CONTENT"]',R='[data-test-id="SYNC_LYRICS_LINE"], [class*="SyncLyricsScroller_line"]',f='[data-test-id="ENTITY_COVER_IMAGE"]',g="ps-apple-cover-bg",m="ps-apple-cover-host",L=.58,C=.08,S=1.2,_=.55;function N(e,t={}){const s=t.preferSmall??!0,r=t.maxWidth??400,i=e.getAttribute("srcset");if(i){const n=i.split(",").map(a=>a.trim()).map(a=>{const[o,l]=a.split(/\s+/),u=l?.endsWith("w")?Number.parseInt(l,10):0,d=l?.endsWith("x")?Number.parseFloat(l):1;return{url:o??"",width:u||Math.round(d*400)}}).filter(a=>a.url);if(n.length>0){if(s){const o=n.filter(u=>u.width<=r).sort((u,d)=>d.width-u.width)[0];if(o?.url)return o.url;const l=n.sort((u,d)=>u.width-d.width)[0];if(l?.url)return l.url}const a=n.sort((o,l)=>l.width-o.width)[0];if(a?.url)return a.url}}return e.currentSrc?e.currentSrc:e.src}var h=new Map,y=new Map,P={size:96,blurPx:14,saturate:1.15,quality:.68};function V(e){return h.get(e)}function B(e,t={}){const s=h.get(e);if(s)return Promise.resolve(s);const r=y.get(e);if(r)return r;const i=U(e,{...P,...t}).finally(()=>{y.delete(e)});return y.set(e,i),i}function U(e,t){return new Promise(s=>{const r=new Image;r.decoding="async",r.crossOrigin="anonymous",r.onload=()=>{const i=k(r,t);i&&(h.set(e,i),D()),s(i)},r.onerror=()=>s(null),r.src=e})}function k(e,t){const s=document.createElement("canvas");s.width=t.size,s.height=t.size;const r=s.getContext("2d",{alpha:!1});if(!r)return null;r.filter=`blur(${t.blurPx}px) saturate(${t.saturate})`,r.drawImage(e,0,0,t.size,t.size);try{return s.toDataURL("image/jpeg",t.quality)}catch{return null}}function D(){if(h.size<=12)return;const e=h.keys().next().value;e&&h.delete(e)}function A(e){let t=0,s=0;return r=>{t||s||(t=window.setTimeout(()=>{t=0,s=requestAnimationFrame(()=>{s=0,r()})},e))}}function M(e){const t=()=>{e(document.hidden||document.visibilityState!=="visible")};return document.addEventListener("visibilitychange",t),t(),()=>{document.removeEventListener("visibilitychange",t)}}var Y=200,F=class{config;host;scheduleApply=A(Y);unsubscribeHost=null;releaseVisibility=null;coverObserver=null;paused=!1;applying=!1;activeModal=null;coverImage=null;layers=null;activeLayerIsA=!0;currentSourceUrl="";constructor(e,t){this.host=e,this.config=t}start(){this.syncCssVariables(),this.releaseVisibility=M(e=>{this.paused=e,this.layers?.root.classList.toggle("ps-apple-cover-bg--paused",e),e||this.scheduleApply(()=>{this.apply(!0)})}),this.unsubscribeHost=this.host.subscribe(e=>this.onModalChange(e))}stop(){this.unsubscribeHost?.(),this.unsubscribeHost=null,this.releaseVisibility?.(),this.releaseVisibility=null,this.detachCoverObserver(),this.teardownModal(),this.activeModal=null}updateOptions(e){this.config=e,this.syncCssVariables(),this.syncMotionClasses(),this.scheduleApply(()=>{this.apply(!0)})}syncCssVariables(){const e=document.documentElement;e.style.setProperty("--ps-cover-blur",`${Math.min(this.config.blurPx,36)}px`),e.style.setProperty("--ps-cover-saturate",String(this.config.saturate)),e.style.setProperty("--ps-cover-overlay",String(this.config.overlayOpacity)),e.style.setProperty("--ps-cover-crossfade",`${this.config.crossfadeMs}ms`),e.style.setProperty("--ps-cover-motion-duration",`${this.config.motionDurationS}s`)}onModalChange(e){this.teardownModal(),this.activeModal=e,this.currentSourceUrl="",e&&(e.classList.add(m),this.ensureLayers(e),this.attachCoverObserver(e),this.scheduleApply(()=>{this.apply(!0)}))}ensureLayers(e){const t=e.querySelector(`.${g}`);if(t){const a=t.querySelector('[data-ps-cover-layer="a"]'),o=t.querySelector('[data-ps-cover-layer="b"]'),l=t.querySelector("[data-ps-cover-vignette]");if(a&&o&&l){this.layers={root:t,layerA:a,layerB:o,vignette:l};return}}const s=document.createElement("div");s.className=g,s.setAttribute("aria-hidden","true");const r=document.createElement("div");r.className="ps-apple-cover-bg__layer ps-apple-cover-bg__layer--a",r.dataset.psCoverLayer="a";const i=document.createElement("div");i.className="ps-apple-cover-bg__layer ps-apple-cover-bg__layer--b",i.dataset.psCoverLayer="b";const n=document.createElement("div");n.className="ps-apple-cover-bg__vignette",n.dataset.psCoverVignette="",s.append(r,i,n),e.prepend(s),this.layers={root:s,layerA:r,layerB:i,vignette:n},this.activeLayerIsA=!0}attachCoverObserver(e){this.detachCoverObserver();const t=i=>{i!==this.coverImage&&(this.coverImage=i,i&&(this.coverObserver=new MutationObserver(()=>{this.scheduleApply(()=>{this.apply(!0)})}),this.coverObserver.observe(i,{attributes:!0,attributeFilter:["src","srcset"]})))};t(e.querySelector(f));const s=new MutationObserver(()=>{t(e.querySelector(f)),this.scheduleApply(()=>{this.apply(!1)})});s.observe(e,{childList:!0,subtree:!0});const r=this.coverObserver;this.coverObserver={disconnect:()=>{s.disconnect(),r?.disconnect()}}}detachCoverObserver(){this.coverObserver?.disconnect(),this.coverObserver=null,this.coverImage=null}async apply(e){if(this.paused||this.applying||!this.activeModal||!this.layers)return;const{root:t}=this.layers;if(t.hidden=!this.config.enabled,!this.config.enabled)return;const s=this.coverImage??this.activeModal.querySelector('[data-test-id="ENTITY_COVER_IMAGE"]');if(!s){t.hidden=!0;return}if(!s.complete||s.naturalWidth===0){s.addEventListener("load",()=>this.scheduleApply(()=>{this.apply(!0)}),{once:!0});return}const r=N(s,{preferSmall:!0,maxWidth:400});if(!r){t.hidden=!0;return}if(!(!e&&r===this.currentSourceUrl)){this.applying=!0;try{const i=await this.resolveBackground(r);if(!i||this.paused)return;t.hidden=!1,this.swapLayers(i.dataUrl,i.useCssBlur),this.currentSourceUrl=r,this.syncMotionClasses()}finally{this.applying=!1}}}async resolveBackground(e){const t=V(e);if(t)return{dataUrl:t,useCssBlur:!1};const s=await B(e,{size:96,blurPx:Math.min(18,Math.round(this.config.blurPx*.3)),saturate:this.config.saturate});return s?{dataUrl:s,useCssBlur:!1}:{dataUrl:e,useCssBlur:!0}}swapLayers(e,t){if(!this.layers)return;const s=this.activeLayerIsA?this.layers.layerB:this.layers.layerA,r=this.activeLayerIsA?this.layers.layerA:this.layers.layerB;s.style.backgroundImage=`url(${JSON.stringify(e)})`,s.classList.toggle("ps-apple-cover-bg__layer--css-blur",t),s.classList.add("ps-apple-cover-bg__layer--visible"),s.classList.toggle("ps-apple-cover-bg__layer--motion",this.config.motionEnabled&&!t),r.classList.remove("ps-apple-cover-bg__layer--visible","ps-apple-cover-bg__layer--motion","ps-apple-cover-bg__layer--css-blur"),r.style.backgroundImage="",this.activeLayerIsA=!this.activeLayerIsA}syncMotionClasses(){if(!this.layers)return;const e=this.config.motionEnabled&&!this.paused;for(const t of[this.layers.layerA,this.layers.layerB]){const s=t.classList.contains("ps-apple-cover-bg__layer--visible"),r=t.classList.contains("ps-apple-cover-bg__layer--css-blur");t.classList.toggle("ps-apple-cover-bg__layer--motion",e&&s&&!r),t.classList.toggle("ps-apple-cover-bg__layer--motion-off",!e)}}teardownModal(){this.detachCoverObserver(),this.activeModal&&(this.activeModal.classList.remove(m),this.layers?.root.remove(),this.layers=null,this.currentSourceUrl="",this.activeLayerIsA=!0)}},X=8,v="data-ps-lyrics-distance";function q(e){return e.classList.contains("swiper-slide-active")?!0:[...e.classList].some(t=>t.includes("SyncLyricsScroller_line_active"))}function H(e){const t=[...e.querySelectorAll(R)];if(t.length)return t;const s=[...document.querySelectorAll(R)];if(s.length)return s;return[...document.querySelectorAll('[data-test-id*="LYRICS"], [class*="LyricsScroller"]')].filter(a=>a instanceof HTMLElement&&a.textContent?.trim())}function $(e){const t=e.findIndex(q);return t>=0?t:e.length>0?Math.floor(e.length/2):-1}function z(e,t,s){if(t<0)return!1;let r=!1;for(let i=0;i<e.length;i+=1){const n=e[i],a=Math.abs(i-t),o=String(a);n.getAttribute(v)!==o&&(n.setAttribute(v,o),r=!0);const l=(a===0?1:Math.max(s.minOpacity,1-a*s.opacityStep)).toFixed(2);n.style.getPropertyValue("opacity")!==l&&(n.style.setProperty("opacity",l,"important"),r=!0);const u=a>0?Math.min(s.maxBlurPx,a*s.blurStepPx):0,d=u>0?`blur(${u}px)`:"none";n.style.getPropertyValue("filter")!==d&&(n.style.setProperty("filter",d,"important"),n.style.setProperty("-webkit-filter",d,"important"),r=!0);const O=a===0?1:Math.max(.985,1-a*.005),I=O<1?`scale(${O.toFixed(3)})`:"none";n.style.transform!==I&&(n.style.transform=I,r=!0)}return r}function E(e){for(const t of e)t.removeAttribute(v),t.style.removeProperty("filter"),t.style.removeProperty("-webkit-filter"),t.style.opacity="",t.style.transform=""}var W=100,G=class{enabled;blurConfig;transitionMs;host;scheduleApply=A(W);unsubscribeHost=null;releaseVisibility=null;lyricsObserver=null;paused=!1;activeModal=null;trackedLines=[];lastActiveIndex=-1;lastLineCount=0;constructor(e,t){this.host=e,this.enabled=t.enabled,this.blurConfig=t.blurConfig,this.transitionMs=t.transitionMs}start(){this.syncTransitionDuration(),this.releaseVisibility=M(e=>{this.paused=e,e||this.scheduleApply(()=>this.apply(!0))}),this.unsubscribeHost=this.host.subscribe(e=>this.onModalChange(e))}stop(){this.unsubscribeHost?.(),this.unsubscribeHost=null,this.releaseVisibility?.(),this.releaseVisibility=null,this.detachLyricsObserver(),this.clearTrackedLines(),this.activeModal=null,this.resetSnapshot()}updateOptions(e){this.enabled=e.enabled,this.blurConfig=e.blurConfig,this.transitionMs=e.transitionMs,this.syncTransitionDuration(),this.resetSnapshot(),this.scheduleApply(()=>this.apply(!0))}syncTransitionDuration(){document.documentElement.style.setProperty("--ps-lyrics-blur-transition",`${this.transitionMs}ms`)}onModalChange(e){this.detachLyricsObserver(),this.clearTrackedLines(),this.resetSnapshot(),this.activeModal=e,e&&(this.attachLyricsObserver(e),this.scheduleApply(()=>this.apply(!0)))}attachLyricsObserver(e){const t=e.querySelector('[data-test-id="SYNC_LYRICS_CONTENT"]')??document.body??e;this.lyricsObserver=new MutationObserver(s=>{this.shouldReactToMutations(s)&&this.scheduleApply(()=>this.apply(!1))}),this.lyricsObserver.observe(t,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class"]})}shouldReactToMutations(e){for(const t of e){if(t.type==="childList")return!0;if(t.type==="attributes"&&t.attributeName==="class"){const s=t.target;if(!(s instanceof HTMLElement))continue;if(s.matches('[data-test-id="SYNC_LYRICS_LINE"], [class*="SyncLyricsScroller_line"]')||s.classList.contains("swiper-slide-active")||s.classList.contains("swiper-slide-prev")||s.classList.contains("swiper-slide-next"))return!0}}return!1}detachLyricsObserver(){this.lyricsObserver?.disconnect(),this.lyricsObserver=null}resetSnapshot(){this.lastActiveIndex=-1,this.lastLineCount=0}apply(e){if(this.paused||!this.activeModal)return;const t=H(this.activeModal);if(t.length===0){this.clearTrackedLines(),this.resetSnapshot();return}if(this.trackedLines=t,!this.enabled){E(t),this.resetSnapshot();return}const s=$(t);!e&&s===this.lastActiveIndex&&t.length===this.lastLineCount||(this.lastActiveIndex=s,this.lastLineCount=t.length,z(t,s,this.blurConfig))}clearTrackedLines(){this.trackedLines.length!==0&&(E(this.trackedLines),this.trackedLines=[])}},j=class{modal=null;observer=null;listeners=new Set;start(){this.scan(),this.observer=new MutationObserver(()=>this.scan()),this.observer.observe(document.documentElement,{childList:!0,subtree:!0})}stop(){this.observer?.disconnect(),this.observer=null,this.setModal(null)}getModal(){return this.modal}subscribe(e){return this.listeners.add(e),e(this.modal),()=>{this.listeners.delete(e)}}scan(){const e=document.querySelector(x);e!==this.modal&&this.setModal(e)}setModal(e){this.modal=e;for(const t of this.listeners)t(e)}};function K(){const e=T(w.name);let t=e.getCurrent();const s=new j,r=new G(s,{enabled:!0,blurConfig:{maxBlurPx:4.5,blurStepPx:.75,minOpacity:L,opacityStep:C},transitionMs:380}),i=new F(s,{enabled:!0,blurPx:28,saturate:S,overlayOpacity:_,crossfadeMs:900,motionEnabled:!0,motionDurationS:26}),n=()=>{r.updateOptions({enabled:p(t,"enabled",!0),blurConfig:{maxBlurPx:c(t,"maxBlur",4.5),blurStepPx:c(t,"blurStep",.75),minOpacity:c(t,"minOpacity",L),opacityStep:c(t,"opacityStep",C)},transitionMs:c(t,"transitionMs",380)}),i.updateOptions({enabled:p(t,"coverBackgroundEnabled",!0),blurPx:c(t,"coverBlur",28),saturate:c(t,"coverSaturate",S),overlayOpacity:c(t,"coverOverlay",_),crossfadeMs:c(t,"coverCrossfadeMs",900),motionEnabled:p(t,"coverMotionEnabled",!0),motionDurationS:c(t,"coverMotionDuration",26)})};s.start(),r.start(),i.start(),n(),e.onChange(a=>{t=a,n()})}K()})();


/* tunerift-direct-lyrics-blur */
;(() => {
  const KEY = '__tuneRiftDirectLyricsBlur';
  window[KEY]?.stop?.();

  const lineSelector = 'div[class*="SyncLyricsScroller_line"]';
  const activeClassFragment = 'SyncLyricsScroller_line_active';
  let rafId = 0;
  let seenCount = -1;

  const isActive = (line) =>
    line.classList.contains('swiper-slide-active') ||
    [...line.classList].some((name) => name.includes(activeClassFragment));

  const getTextNode = (line) =>
    line.querySelector(':scope > span[class*="SyncLyricsLine_root"]') ||
    line.querySelector(':scope > span') ||
    line.querySelector('span') ||
    line;

  const set = (node, property, value) => node.style.setProperty(property, value, 'important');

  const clear = (node) => {
    node.style.removeProperty('filter');
    node.style.removeProperty('-webkit-filter');
    node.style.removeProperty('opacity');
    node.style.removeProperty('transform');
    node.style.removeProperty('transition');
    delete node.dataset.tuneriftLyricsBlur;
  };

  const apply = () => {
    rafId = 0;
    const lines = [...document.querySelectorAll(lineSelector)]
      .filter((line) => line.textContent?.trim());
    if (!lines.length) return;

    const activeIndex = lines.findIndex(isActive);
    if (activeIndex < 0) return;

    lines.forEach((line, index) => {
      const text = getTextNode(line);
      const distance = Math.abs(index - activeIndex);
      const blur = distance === 0 ? 0 : Math.min(4.5, 0.8 * distance);
      const opacity = distance === 0 ? 1 : Math.max(0.58, 0.92 - 0.085 * distance);
      const scale = distance === 0 ? 1 : Math.max(0.985, 1 - 0.004 * distance);
      const filter = blur ? `blur(${blur.toFixed(2)}px)` : 'none';

      // Yandex may hide the entire previous slide before our text-level blur is visible.
      // Keep the line container rendered; the child span below controls the actual fade.
      set(line, 'opacity', '1');
      set(line, 'visibility', 'visible');
      set(line, 'filter', 'none');
      set(line, '-webkit-filter', 'none');
      line.dataset.tuneriftLyricsLineVisible = 'true';

      set(text, 'transition', 'filter 280ms cubic-bezier(.2,.7,.2,1), opacity 280ms cubic-bezier(.2,.7,.2,1), transform 280ms cubic-bezier(.2,.7,.2,1)');
      set(text, 'filter', filter);
      set(text, '-webkit-filter', filter);
      set(text, 'opacity', opacity.toFixed(2));
      set(text, 'transform', `translateZ(0) scale(${scale.toFixed(3)})`);
      text.dataset.tuneriftLyricsBlur = String(distance);
    });

    if (seenCount !== lines.length) {
      seenCount = lines.length;
      console.info('[tunerift-lyrics-blur] applied to text spans', { lines: lines.length, activeIndex });
    }
  };

  const schedule = () => {
    if (!rafId) rafId = requestAnimationFrame(apply);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
  const timerId = window.setInterval(schedule, 450);
  window[KEY] = {
    stop() {
      observer.disconnect();
      window.clearInterval(timerId);
      if (rafId) cancelAnimationFrame(rafId);
      document.querySelectorAll('[data-tunerift-lyrics-blur]').forEach(clear);
      document.querySelectorAll('[data-tunerift-lyrics-line-visible]').forEach((line) => {
        line.style.removeProperty('opacity');
        line.style.removeProperty('visibility');
        line.style.removeProperty('filter');
        line.style.removeProperty('-webkit-filter');
        delete line.dataset.tuneriftLyricsLineVisible;
      });
    }
  };
  schedule();
})();
