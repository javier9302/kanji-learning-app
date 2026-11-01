/* =========================================
   KANJI LEARNING APP - darumi.js
   Darumi, la mascota de Yomipop, como componente <yomi-darumi> (estados
   idle, appear, pop, talk, curious, celebrate, oops, sleep, goal-start y
   goal-done; tiempos y reglas en el sistema de diseño Yomipop, componente
   Darumi). Copiado tal cual de components/bundle.js del sistema de diseño:
   si cambia allí, se vuelve a copiar. No depende de nada de la app.
   ========================================= */
/* @ds-bundle: {"format":4,"namespace":"Yomipop","components":[{"name":"Darumi"}]} */
(function () {
  'use strict';
  var SVG = "<svg viewBox=\"0 0 540 520\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><ellipse class=\"shade c-shade\" cx=\"226\" cy=\"508\" rx=\"150\" ry=\"13\"/><g class=\"rig\"><g class=\"sq\"><g transform=\"translate(-30 30)\"><path class=\"c-beni\" d=\"M256 52C384 52 462 150 462 292C462 404 374 476 256 476C138 476 50 404 50 292C50 150 128 52 256 52Z\"/><path class=\"s-shine\" d=\"M108 214C116 160 146 118 186 94\"/><ellipse class=\"c-face\" cx=\"256\" cy=\"214\" rx=\"128\" ry=\"100\"/><g class=\"s-ink brow brows-n\" stroke-width=\"15\"><path d=\"M176 168Q202 146 232 160\"/><path d=\"M280 160Q310 146 336 168\"/></g><g class=\"s-ink brow brows-up alt\" stroke-width=\"15\"><path d=\"M176 156Q202 132 232 148\"/><path d=\"M282 170Q310 162 336 172\"/></g><g class=\"s-ink brow brows-worry alt\" stroke-width=\"15\"><path d=\"M178 166Q204 160 230 146\"/><path d=\"M282 146Q308 160 334 166\"/></g><g class=\"s-ink brow brows-calm alt\" stroke-width=\"15\"><path d=\"M180 174Q204 164 230 170\"/><path d=\"M282 170Q308 164 332 174\"/></g><ellipse class=\"c-cheek\" cx=\"176\" cy=\"250\" rx=\"19\" ry=\"12\"/><ellipse class=\"c-cheek\" cx=\"336\" cy=\"250\" rx=\"19\" ry=\"12\"/><g class=\"eyes-open\"><g class=\"look\"><g class=\"blink\"><circle class=\"c-ink\" cx=\"214\" cy=\"212\" r=\"25\"/><circle class=\"c-hl\" cx=\"222\" cy=\"203\" r=\"8.5\"/><circle class=\"c-ink\" cx=\"298\" cy=\"212\" r=\"25\"/><circle class=\"c-hl\" cx=\"306\" cy=\"203\" r=\"8.5\"/></g></g></g><g class=\"s-ink eyes-happy alt\" stroke-width=\"13\"><path d=\"M190 222Q208 196 228 222\"/><path d=\"M284 222Q302 196 322 222\"/></g><g class=\"s-ink eyes-closed alt\" stroke-width=\"11\"><path d=\"M194 210Q214 228 234 210\"/><path d=\"M278 210Q298 228 318 210\"/></g><g class=\"s-ink eyes-squeeze alt\" stroke-width=\"11\"><path d=\"M198 198L224 212L198 226\"/><path d=\"M314 198L288 212L314 226\"/></g><g class=\"eyes-blank alt\"><circle class=\"s-ink\" stroke-width=\"5\" cx=\"214\" cy=\"212\" r=\"25\"/><circle class=\"s-ink\" stroke-width=\"5\" cx=\"298\" cy=\"212\" r=\"25\"/></g><g class=\"paint paint-l alt\"><circle class=\"c-ink\" cx=\"214\" cy=\"212\" r=\"25\"/><circle class=\"c-hl\" cx=\"222\" cy=\"203\" r=\"8.5\"/></g><g class=\"paint paint-r alt\"><circle class=\"c-ink\" cx=\"298\" cy=\"212\" r=\"25\"/><circle class=\"c-hl\" cx=\"306\" cy=\"203\" r=\"8.5\"/></g><path class=\"s-ink m-smile\" stroke-width=\"9\" d=\"M238 254Q256 272 274 254\"/><g class=\"m-open alt\"><path class=\"c-ink\" d=\"M228 246H284Q284 290 256 290Q228 290 228 246Z\"/><path class=\"c-tongue\" d=\"M240 278Q256 266 272 278Q266 290 256 290Q246 290 240 278Z\"/></g><ellipse class=\"c-ink m-o alt\" cx=\"258\" cy=\"262\" rx=\"11\" ry=\"13\"/><g class=\"mt m-talk alt\"><ellipse class=\"c-ink\" cx=\"256\" cy=\"262\" rx=\"17\" ry=\"14\"/><ellipse class=\"c-tongue\" cx=\"256\" cy=\"270\" rx=\"9\" ry=\"5\"/></g><path class=\"s-ink m-sleep alt\" stroke-width=\"7\" d=\"M246 262Q256 268 266 262\"/><path class=\"s-ink m-wavy alt\" stroke-width=\"7\" d=\"M232 262q8 -8 16 0t16 0t16 0\"/><path class=\"c-yuzu\" transform=\"translate(203.12 423.36) scale(0.10400 -0.10400)\" d=\"M691 330V69C691 -49 712 -90 812 -90C830 -90 851 -90 870 -90C948 -90 981 -48 992 107C957 116 899 138 874 160C872 51 868 35 855 35C851 35 841 35 837 35C826 35 825 38 825 70V330ZM71 546V438H355V546ZM77 826V718H352V826ZM71 408V300H355V408ZM25 689V576H386V689ZM67 267V-80H184V-42H358V2C384 -27 412 -70 424 -99C614 -17 639 124 645 331H513V369H826V279H960V481H385V279H509C502 156 480 77 358 26V267ZM596 856V789H401V672H596V631H434V515H921V631H740V672H951V789H740V856ZM184 155H240V70H184Z\"/><g class=\"popcore\"><circle class=\"c-ring\" cx=\"410\" cy=\"96\" r=\"62\"/><circle class=\"c-yuzu dot\" cx=\"410\" cy=\"96\" r=\"46\"/></g><g class=\"s-yuzu rays\"><path d=\"M410 6V-12\"/><path d=\"M476 32L488.6 19.4\"/><path d=\"M502 96H520\"/></g><g class=\"z z1\"><g transform=\"translate(300 30) scale(1.3)\"><path class=\"s-zz\" d=\"M0 0H24L0 26H24\"/></g></g><g class=\"z z2\"><g transform=\"translate(350 -30) scale(1.7)\"><path class=\"s-zz\" d=\"M0 0H24L0 26H24\"/></g></g><g class=\"z z3\"><g transform=\"translate(410 -100) scale(2.1)\"><path class=\"s-zz\" d=\"M0 0H24L0 26H24\"/></g></g></g></g></g><g class=\"sparks\"><g transform=\"translate(-30 30)\"><g class=\"spark sp1\"><g transform=\"translate(10 110) scale(2.2)\"><path class=\"c-yuzu\" d=\"M0 -22Q4 -4 22 0Q4 4 0 22Q-4 4 -22 0Q-4 -4 0 -22Z\"/></g></g><g class=\"spark sp2\"><g transform=\"translate(520 250) scale(1.7)\"><path class=\"c-yuzu\" d=\"M0 -22Q4 -4 22 0Q4 4 0 22Q-4 4 -22 0Q-4 -4 0 -22Z\"/></g></g><g class=\"spark sp3\"><g transform=\"translate(0 360) scale(1.5)\"><path class=\"c-yuzu\" d=\"M0 -22Q4 -4 22 0Q4 4 0 22Q-4 4 -22 0Q-4 -4 0 -22Z\"/></g></g><g class=\"spark sp4\"><g transform=\"translate(500 430) scale(2.2)\"><path class=\"c-yuzu\" d=\"M0 -22Q4 -4 22 0Q4 4 0 22Q-4 4 -22 0Q-4 -4 0 -22Z\"/></g></g><g class=\"spark sp5\"><g transform=\"translate(160 -30) scale(1.4)\"><path class=\"c-yuzu\" d=\"M0 -22Q4 -4 22 0Q4 4 0 22Q-4 4 -22 0Q-4 -4 0 -22Z\"/></g></g></g></g></svg>";
  var CSS = ":host{display:inline-block;width:var(--darumi-size,160px);aspect-ratio:540/520;line-height:0;-webkit-tap-highlight-color:transparent;vertical-align:bottom} :host([interactive]){cursor:pointer} svg{width:100%;height:100%;display:block;overflow:visible} .c-beni{fill:var(--beni-500,#EE4B2B)} .s-shine{fill:none;stroke:#FF7E62;stroke-width:18;stroke-linecap:round;opacity:.9} .c-face{fill:#FFF8EE} .c-ink{fill:#221A26} .s-ink{fill:none;stroke:#221A26;stroke-linecap:round;stroke-linejoin:round} .c-hl{fill:#FFF8EE} .c-cheek{fill:#FF9C88} .c-tongue{fill:#FF8A80} .c-yuzu{fill:var(--yuzu-400,#FFC23D)} .s-yuzu{fill:none;stroke:var(--yuzu-400,#FFC23D);stroke-width:16;stroke-linecap:round} .c-ring{fill:var(--darumi-ring,var(--surface-100,#FFF8EE))} .c-shade{fill:rgba(34,26,38,.14)} .s-zz{fill:none;stroke:var(--ink-muted,#6E6272);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}  .rig,.sq{transform-box:view-box;transform-origin:226px 506px} .blink,.look,.popcore,.paint,.spark,.z,.shade,.brow{transform-box:fill-box;transform-origin:50% 50%} .mt{transform-box:fill-box;transform-origin:50% 0%}  .alt,.z,.spark{display:none}  /* --- default / idle: breathing, blinking, twinkling pop --- */ .sq{animation:dm-breathe 2.6s ease-in-out infinite} .blink{animation:dm-blink 4.2s infinite} .rays{animation:dm-twinkle 2.6s ease-in-out infinite}  /* --- pop (tap a word) --- */ :host([state=\"pop\"]) .sq{animation:dm-squash .52s ease-out both} :host([state=\"pop\"]) .popcore{animation:dm-popdot .52s ease-out both} :host([state=\"pop\"]) .rays{animation:dm-rayflash .52s ease-out both}  /* --- appear (entrance) --- */ :host([state=\"appear\"]) .rig{animation:dm-drop .82s both} :host([state=\"appear\"]) .sq{animation:dm-land .82s both} :host([state=\"appear\"]) .shade{animation:dm-shade-in .82s both}  /* --- celebrate (loop) --- */ :host([state=\"celebrate\"]) .eyes-open,:host([state=\"celebrate\"]) .m-smile{display:none} :host([state=\"celebrate\"]) .eyes-happy,:host([state=\"celebrate\"]) .m-open,:host([state=\"celebrate\"]) .spark{display:inline} :host([state=\"celebrate\"]) .rig{animation:dm-hop 1.1s infinite} :host([state=\"celebrate\"]) .sq{animation:dm-hop-sq 1.1s infinite} :host([state=\"celebrate\"]) .shade{animation:dm-hop-shade 1.1s infinite} :host([state=\"celebrate\"]) .rays{animation:dm-raypulse .55s ease-in-out infinite} :host([state=\"celebrate\"]) .spark{animation:dm-sparkle 1.1s ease-out infinite} :host([state=\"celebrate\"]) .sp2{animation-delay:.18s}:host([state=\"celebrate\"]) .sp3{animation-delay:.36s}:host([state=\"celebrate\"]) .sp4{animation-delay:.54s}:host([state=\"celebrate\"]) .sp5{animation-delay:.72s}  /* --- curious (loop) --- */ :host([state=\"curious\"]) .brows-n,:host([state=\"curious\"]) .m-smile{display:none} :host([state=\"curious\"]) .brows-up,:host([state=\"curious\"]) .m-o{display:inline} :host([state=\"curious\"]) .rig{animation:dm-tilt 3.4s ease-in-out infinite} :host([state=\"curious\"]) .look{animation:dm-look 3.4s ease-in-out infinite} :host([state=\"curious\"]) .brows-up{animation:dm-browbob 3.4s ease-in-out infinite}  /* --- talk (loop) --- */ :host([state=\"talk\"]) .m-smile{display:none} :host([state=\"talk\"]) .m-talk{display:inline} :host([state=\"talk\"]) .mt{animation:dm-talk .18s ease-in-out infinite alternate} :host([state=\"talk\"]) .rig{animation:dm-nod .72s ease-in-out infinite}  /* --- oops: tips over and rights itself (\u4e03\u8ee2\u3073\u516b\u8d77\u304d) --- */ :host([state=\"oops\"]) .eyes-squeeze,:host([state=\"oops\"]) .brows-worry,:host([state=\"oops\"]) .m-wavy{display:inline;animation:dm-early 1.85s both} :host([state=\"oops\"]) .eyes-open,:host([state=\"oops\"]) .brows-n,:host([state=\"oops\"]) .m-smile{animation:dm-late 1.85s both} :host([state=\"oops\"]) .rig{animation:dm-wobble 1.85s both} :host([state=\"oops\"]) .sq{animation:none} :host([state=\"oops\"]) .shade{animation:dm-wobble-shade 1.85s both}  /* --- sleep (loop) --- */ :host([state=\"sleep\"]) .eyes-open,:host([state=\"sleep\"]) .m-smile,:host([state=\"sleep\"]) .brows-n,:host([state=\"sleep\"]) .rays{display:none} :host([state=\"sleep\"]) .eyes-closed,:host([state=\"sleep\"]) .m-sleep,:host([state=\"sleep\"]) .brows-calm,:host([state=\"sleep\"]) .z{display:inline} :host([state=\"sleep\"]) .rig{animation:dm-lean 4s ease-in-out infinite} :host([state=\"sleep\"]) .sq{animation:dm-sleepbreathe 4s ease-in-out infinite} :host([state=\"sleep\"]) .popcore{opacity:.5} :host([state=\"sleep\"]) .z{animation:dm-z 3s ease-out infinite} :host([state=\"sleep\"]) .z2{animation-delay:1s} :host([state=\"sleep\"]) .z3{animation-delay:2s}  /* --- goal: the daruma eye-painting ritual (\u76ee\u5165\u308c) --- */ :host([state^=\"goal\"]) .eyes-open{display:none} :host([state^=\"goal\"]) .eyes-blank,:host([state^=\"goal\"]) .paint-l{display:inline} :host([state=\"goal-start\"]) .paint-l{animation:dm-paint .9s .3s both} :host([state=\"goal-done\"]) .paint-r,:host([state=\"goal-done\"]) .spark{display:inline} :host([state=\"goal-done\"]) .paint-r{animation:dm-paint .8s .35s both} :host([state=\"goal-done\"]) .rig{animation:dm-goal-hop 2.3s both} :host([state=\"goal-done\"]) .sq{animation:dm-goal-sq 2.3s both} :host([state=\"goal-done\"]) .popcore{animation:dm-popdot .52s 1.45s both} :host([state=\"goal-done\"]) .rays{animation:dm-rayflash .52s 1.45s both} :host([state=\"goal-done\"]) .spark{animation:dm-sparkle 1.1s 1.35s both} :host([state=\"goal-done\"]) .sp2{animation-delay:1.45s}:host([state=\"goal-done\"]) .sp3{animation-delay:1.55s}:host([state=\"goal-done\"]) .sp4{animation-delay:1.65s}:host([state=\"goal-done\"]) .sp5{animation-delay:1.75s}  @keyframes dm-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(.985,1.03)}} @keyframes dm-blink{0%,90%,96%,100%{transform:scaleY(1)}93%{transform:scaleY(.1)}} @keyframes dm-twinkle{0%,100%{opacity:1}50%{opacity:.5}} @keyframes dm-squash{0%{transform:scale(1,1)}22%{transform:scale(1.12,.86)}50%{transform:scale(.93,1.1)}75%{transform:scale(1.03,.97)}100%{transform:scale(1,1)}} @keyframes dm-popdot{0%{transform:scale(1)}30%{transform:scale(1.4)}60%{transform:scale(.9)}100%{transform:scale(1)}} @keyframes dm-rayflash{0%{stroke-width:16;opacity:1}30%{stroke-width:26;opacity:1}100%{stroke-width:16;opacity:1}} @keyframes dm-drop{0%{transform:translateY(-220px);opacity:0;animation-timing-function:cubic-bezier(.55,0,1,.45)}12%{opacity:1}50%{transform:translateY(0);animation-timing-function:cubic-bezier(0,.55,.45,1)}67%{transform:translateY(-34px);animation-timing-function:cubic-bezier(.55,0,1,.45)}84%,100%{transform:translateY(0)}} @keyframes dm-land{0%,48%{transform:scale(.94,1.08)}55%{transform:scale(1.16,.82)}68%{transform:scale(.97,1.04)}86%{transform:scale(1.06,.94)}100%{transform:scale(1,1)}} @keyframes dm-shade-in{0%{transform:scale(.3);opacity:0}50%{transform:scale(1);opacity:1}67%{transform:scale(.8)}84%,100%{transform:scale(1);opacity:1}} @keyframes dm-hop{0%,18%{transform:translateY(0) rotate(0);animation-timing-function:cubic-bezier(0,.55,.45,1)}50%{transform:translateY(-80px) rotate(-5deg);animation-timing-function:cubic-bezier(.55,0,1,.45)}80%,100%{transform:translateY(0) rotate(0)}} @keyframes dm-hop-sq{0%{transform:scale(1,1)}16%{transform:scale(1.12,.86)}30%{transform:scale(.92,1.1)}50%{transform:scale(1,1)}80%{transform:scale(1.1,.88)}92%{transform:scale(.98,1.02)}100%{transform:scale(1,1)}} @keyframes dm-hop-shade{0%,18%,80%,100%{transform:scale(1);opacity:1}50%{transform:scale(.6);opacity:.5}} @keyframes dm-raypulse{0%,100%{stroke-width:16}50%{stroke-width:24}} @keyframes dm-sparkle{0%{transform:scale(0) rotate(0);opacity:1}40%{transform:scale(1) rotate(45deg);opacity:1}80%,100%{transform:scale(0) rotate(90deg);opacity:0}} @keyframes dm-tilt{0%,100%{transform:rotate(0)}18%,62%{transform:rotate(9deg)}80%{transform:rotate(0)}} @keyframes dm-look{0%,15%,75%,100%{transform:translateX(0)}25%,40%{transform:translateX(-10px)}50%,62%{transform:translateX(10px)}} @keyframes dm-browbob{0%,100%,80%{transform:translateY(0)}20%,60%{transform:translateY(-6px)}} @keyframes dm-talk{from{transform:scaleY(.3)}to{transform:scaleY(1)}} @keyframes dm-nod{0%,100%{transform:rotate(0)}50%{transform:rotate(-2.5deg)}} @keyframes dm-wobble{0%{transform:rotate(0);animation-timing-function:cubic-bezier(.5,0,.9,.5)}10%{transform:rotate(-30deg);animation-timing-function:ease-in-out}25%{transform:rotate(19deg);animation-timing-function:ease-in-out}39%{transform:rotate(-12deg);animation-timing-function:ease-in-out}52%{transform:rotate(7deg);animation-timing-function:ease-in-out}65%{transform:rotate(-4deg);animation-timing-function:ease-in-out}77%{transform:rotate(2deg);animation-timing-function:ease-in-out}88%{transform:rotate(-.8deg)}100%{transform:rotate(0)}} @keyframes dm-wobble-shade{0%,100%{transform:scaleX(1)}10%{transform:scaleX(.8)}25%{transform:scaleX(.88)}52%,100%{transform:scaleX(1)}} @keyframes dm-early{0%,55%{opacity:1}60%,100%{opacity:0}} @keyframes dm-late{0%,55%{opacity:0}60%,100%{opacity:1}} @keyframes dm-lean{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(-2.5deg)}} @keyframes dm-sleepbreathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.02,1.035)}} @keyframes dm-z{0%{transform:translate(0,0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translate(40px,-90px) scale(1.1);opacity:0}} @keyframes dm-paint{0%{transform:scale(0) rotate(-120deg)}60%{transform:scale(1.25) rotate(10deg)}80%{transform:scale(.92) rotate(0)}100%{transform:scale(1) rotate(0)}} @keyframes dm-goal-hop{0%,55%{transform:translateY(0);animation-timing-function:cubic-bezier(0,.55,.45,1)}70%{transform:translateY(-70px);animation-timing-function:cubic-bezier(.55,0,1,.45)}84%,100%{transform:translateY(0)}} @keyframes dm-goal-sq{0%,50%{transform:scale(1,1)}55%{transform:scale(1.12,.86)}62%{transform:scale(.93,1.09)}70%{transform:scale(1,1)}84%{transform:scale(1.1,.9)}92%{transform:scale(.98,1.02)}100%{transform:scale(1,1)}}  @media (prefers-reduced-motion: reduce){ *{animation:none!important} :host([state=\"oops\"]) .eyes-squeeze,:host([state=\"oops\"]) .brows-worry,:host([state=\"oops\"]) .m-wavy{display:none} :host([state=\"celebrate\"]) .spark,:host([state=\"goal-done\"]) .spark,:host([state=\"sleep\"]) .z{display:none} }";
  var STATES = ["idle", "appear", "pop", "talk", "curious", "celebrate", "oops", "sleep", "goal-start", "goal-done"];
  var ONE_SHOT = {"appear": 820, "pop": 520, "oops": 1850, "goal-done": 2700};

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  var Base = typeof HTMLElement !== 'undefined' ? HTMLElement : function () {};

  class YomiDarumi extends Base {
    static get observedAttributes() { return ['state', 'size', 'label']; }
    constructor() {
      super();
      var root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + CSS + '</style>' + SVG;
      this._timer = null;
      this._onClick = this._onClick.bind(this);
    }
    connectedCallback() {
      if (!this.hasAttribute('state')) this.setAttribute('state', 'idle');
      if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
      this._label();
      this._size();
      this.addEventListener('click', this._onClick);
      this._schedule();
    }
    disconnectedCallback() {
      clearTimeout(this._timer);
      this.removeEventListener('click', this._onClick);
    }
    attributeChangedCallback(name) {
      if (name === 'state') this._schedule();
      if (name === 'size') this._size();
      if (name === 'label') this._label();
    }
    get state() { return this.getAttribute('state') || 'idle'; }
    set state(v) { this.setAttribute('state', v); }
    /* Play a state from its first frame, even if it is already the current one. */
    play(state) {
      this.setAttribute('state', '_');
      void this.getBoundingClientRect();
      this.setAttribute('state', state);
      return this;
    }
    _onClick() { if (this.hasAttribute('interactive')) this.play('pop'); }
    _size() {
      var s = this.getAttribute('size');
      if (s) this.style.setProperty('--darumi-size', /^\d+$/.test(s) ? s + 'px' : s);
    }
    _label() { this.setAttribute('aria-label', this.getAttribute('label') || 'Darumi'); }
    _schedule() {
      clearTimeout(this._timer);
      var s = this.getAttribute('state');
      if (!Object.prototype.hasOwnProperty.call(ONE_SHOT, s)) return;
      var self = this;
      this._timer = setTimeout(function () {
        if (self.getAttribute('state') !== s) return;
        self.setAttribute('state', self.getAttribute('rest') || 'idle');
        self.dispatchEvent(new CustomEvent('darumi-done', { detail: { state: s }, bubbles: true }));
      }, reducedMotion() ? 200 : ONE_SHOT[s]);
    }
  }

  if (typeof window !== 'undefined' && window.customElements && !window.customElements.get('yomi-darumi')) {
    window.customElements.define('yomi-darumi', YomiDarumi);
  }

  var ns = (typeof window !== 'undefined' && window.Yomipop) || {};
  ns.Darumi = {
    tagName: 'yomi-darumi',
    states: STATES,
    oneShot: Object.keys(ONE_SHOT),
    durations: ONE_SHOT,
    /* Create a Darumi element: Yomipop.Darumi.create({ state: 'appear', rest: 'idle', size: 160, interactive: true }) */
    create: function (opts) {
      opts = opts || {};
      var el = document.createElement('yomi-darumi');
      if (opts.state) el.setAttribute('state', opts.state);
      if (opts.rest) el.setAttribute('rest', opts.rest);
      if (opts.size) el.setAttribute('size', String(opts.size));
      if (opts.label) el.setAttribute('label', opts.label);
      if (opts.interactive) el.setAttribute('interactive', '');
      return el;
    }
  };
  if (typeof window !== 'undefined') window.Yomipop = ns;
})();
