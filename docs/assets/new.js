/* Shared header, footer, dropdown menus and the picture viewer (lightbox).
   In the finished site the header and footer would be written into each page ahead of time; here one file keeps the mockup easy to change. */
(function () {
  var P = (d) => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  var IC = {
    read: P('<path d="M3 5.5C5.5 4 9 4 12 6c3-2 6.5-2 9-.5V19c-2.5-1.5-6-1.5-9 .5-3-2-6.5-2-9-.5z"/><path d="M12 6v13.5"/>'),
    ask: P('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>'),
    study: P('<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 8h6M8 12h6"/>'),
    stories: P('<rect x="3" y="4" width="14" height="16" rx="2"/><path d="M7 9h6M7 13h4"/><path d="M17 8l4 1v10l-4-1"/>'),
    daily: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
    pictures: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 9"/>'),
    present: P('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>'),
    sync: P('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>'),
    library: P('<path d="M4 4v16M9 4v16M14 6l5 14"/>'),
    win: P('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    phone: P('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
    down: P('<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>'),
    chev: P('<path d="m6 9 6 6 6-6"/>'),
    menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    music: P('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    x: P('<path d="M6 6l12 12M18 6 6 18"/>')
  };
  window.IC = IC;
  var FEATURES = [
    ["read", "Read and search", "One search box, five Bibles, 1,200+ more, read aloud", "read"],
    ["ask", "Ask and understand", "Answers that quote the Bible first; word study", "ask"],
    ["stories", "Stories and children", "Bible stories, verse pages, children's pages, maps", "stories"],
    ["daily", "Daily life", "Daily Scroll, how are you today, prayer list", "daily"],
    ["pictures", "Pictures and sharing", "Verse pictures, Content Factory", "pictures"],
    ["present", "Preach and present", "Sermon builder, slides, Sunday service", "present"],
    ["sync", "Your study and sync", "Notes, backup, phone and computer in step", "sync"],
    ["library", "Library and extras", "Free books, commentaries, themes", "library"]
  ];
  var page = document.body.getAttribute("data-page") || "";
  var R = document.body.getAttribute("data-root") || "";
  var MUSIC = "https://music.youtube.com/channel/UCOmYicXYhihT-vUOFE99ETw";
  if (/Android/i.test(navigator.userAgent || "")) document.documentElement.classList.add("is-android");
  var cur = (p) => (page === p ? ' aria-current="page"' : "");
  var header =
    '<a class="skip" href="#main">Skip to the content</a>' +
    '<header class="hdr"><div class="wrap hdr-in">' +
    '<a class="brand" href="HOME"><img src="assets/icon.png" alt=""><span>Bible Concordance</span></a>' +
    '<button class="burger" aria-expanded="false" aria-controls="nav" aria-label="Menu">' + IC.menu + "</button>" +
    '<nav class="nav" id="nav" aria-label="Main">' +
    '<div class="dd"><button class="dd-btn" aria-expanded="false"' + (page === "features" ? ' aria-current="true"' : "") + ">Features " + IC.chev + '</button><div class="dd-menu mega">' +
    FEATURES.map((f) => '<a href="features.html#' + f[3] + '">' + IC[f[0]] + "<span><b>" + f[1] + "</b><small>" + f[2] + "</small></span></a>").join("") +
    "</div></div>" +
    '<a href="screenshots.html"' + cur("screenshots") + ">Screenshots</a>" +
    '<a href="videos.html"' + cur("videos") + ">Videos</a>" +
    '<a href="' + MUSIC + '" target="_blank" rel="noopener" title="Southern Cross Music on YouTube Music">' + IC.music + "Music</a>" +
    '<div class="dd"><button class="dd-btn" aria-expanded="false">Help ' + IC.chev + '</button><div class="dd-menu plain right">' +
    '<a href="download.html#faq"><span><b>Questions and answers</b></span></a>' +
    '<a href="privacy/"><span><b>Privacy policy</b></span></a>' +
    '<a href="terms/"><span><b>Licence and terms</b></span></a>' +
    '<a href="credits/"><span><b>Credits and attribution</b></span></a>' +
    '<a href="disclaimer/"><span><b>Disclaimer</b></span></a>' +
    '<a href="refunds/"><span><b>Refund policy</b></span></a>' +
    "</div></div>" +
    '<a class="btn nav-dl" href="download.html"' + cur("download") + ">Download</a>" +
    "</nav></div></header>";
  var footer =
    '<footer class="ftr"><div class="wrap"><div class="ftr-grid">' +
    '<div><a class="brand" href="HOME"><img src="assets/icon.png" alt=""><span>Bible Concordance</span></a>' +
    '<p style="margin-top:10px">Free Bible study that works without the internet. No account, no adverts, no tracking. Free, always.</p>' +
    '<div class="thanks"><img src="assets/south-point-church.png" alt="South Point Church"><span>With thanks to Pastor Mike and South Point Church, who inspired this app. &ldquo;Freely you received; freely give.&rdquo; Matthew 10:8</span></div></div>' +
    '<div><h4>Explore</h4><ul><li><a href="features.html">Features</a></li><li><a href="screenshots.html">Screenshots</a></li><li><a href="videos.html">Video guides</a></li><li><a href="download.html">Download</a></li><li><a href="' + MUSIC + '" target="_blank" rel="noopener">&#9835; Southern Cross Music</a></li></ul></div>' +
    '<div><h4>Get the app</h4><ul><li><a href="download.html#windows">For Windows</a></li><li><a href="download.html#android">For Android</a></li><li><a href="download.html#faq">Questions</a></li></ul></div>' +
    '<div><h4>Good to know</h4><ul><li><a href="privacy/">Privacy policy</a></li><li><a href="terms/">Licence &amp; terms</a></li><li><a href="credits/">Credits &amp; attribution</a></li><li><a href="disclaimer/">Disclaimer</a></li><li><a href="refunds/">Refund policy</a></li></ul></div>' +
    '</div><div class="fine">&copy; Bible Concordance. Built-in Bibles and data are public domain or openly licensed.</div></div></footer>';
  var fix = (h) => h.replace(/(href|src)="(?!https?:|#|mailto:)/g, "$1=\"" + R);
  header = fix(header); footer = fix(footer);
  header = header.replace(/href="(?:\.\.\/)?HOME"/g, 'href="' + (R || "./") + '"'); footer = footer.replace(/href="(?:\.\.\/)?HOME"/g, 'href="' + (R || "./") + '"');
  document.body.insertAdjacentHTML("afterbegin", header);
  document.body.insertAdjacentHTML("beforeend", footer);
  document.querySelectorAll("[data-ic]").forEach((el) => { el.innerHTML = IC[el.getAttribute("data-ic")] + el.innerHTML; });

  /* menus */
  var nav = document.getElementById("nav"), burger = document.querySelector(".burger");
  function closeAll(except) { document.querySelectorAll(".dd.open").forEach((d) => { if (d !== except) { d.classList.remove("open"); d.querySelector(".dd-btn").setAttribute("aria-expanded", "false"); } }); }
  document.querySelectorAll(".dd-btn").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation(); var d = b.parentNode, open = !d.classList.contains("open"); closeAll(d);
    d.classList.toggle("open", open); b.setAttribute("aria-expanded", open ? "true" : "false");
  }));
  document.querySelectorAll(".dd").forEach((d) => d.addEventListener("mouseenter", () => { if (window.innerWidth > 880) { closeAll(d); d.classList.add("open"); d.querySelector(".dd-btn").setAttribute("aria-expanded", "true"); } }));
  document.querySelector(".hdr").addEventListener("mouseleave", () => { if (window.innerWidth > 880) closeAll(); });
  document.addEventListener("click", () => closeAll());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeAll(); nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); } });
  burger.addEventListener("click", () => { var o = nav.classList.toggle("open"); burger.setAttribute("aria-expanded", o ? "true" : "false"); burger.innerHTML = o ? IC.x : IC.menu; });
  nav.addEventListener("click", (e) => { if (e.target.closest("a") && window.innerWidth <= 880) { nav.classList.remove("open"); burger.innerHTML = IC.menu; } });

  /* picture viewer: any element with data-shot="<index into SHOTS list>" opens it; list = the elements shown right now */
  var lb = document.createElement("div");
  lb.className = "lb"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Screenshot");
  lb.innerHTML = '<button class="x" aria-label="Close">&times;</button><button class="pv" aria-label="Previous">&lsaquo;</button><img alt=""><div class="lbcap"></div><button class="nx" aria-label="Next">&rsaquo;</button>';
  document.body.appendChild(lb);
  var list = [], at = 0, opener = null;
  function show(i) {
    at = (i + list.length) % list.length; var s = list[at];
    lb.querySelector("img").src = window.shotSrc(s); lb.querySelector("img").alt = s.t;
    lb.querySelector(".lbcap").innerHTML = "<b></b><span></span>"; lb.querySelector(".lbcap b").textContent = s.t; lb.querySelector(".lbcap span").textContent = s.c;
  }
  window.openShot = function (items, i, from) { list = items; opener = from || null; show(i); lb.classList.add("open"); lb.querySelector(".x").focus(); };
  function close() { lb.classList.remove("open"); if (opener) opener.focus(); }
  lb.querySelector(".x").onclick = close; lb.querySelector(".pv").onclick = () => show(at - 1); lb.querySelector(".nx").onclick = () => show(at + 1);
  lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
  document.addEventListener("keydown", (e) => { if (!lb.classList.contains("open")) return; if (e.key === "Escape") close(); if (e.key === "ArrowLeft") show(at - 1); if (e.key === "ArrowRight") show(at + 1); });
  var tx = null; lb.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => { if (tx === null) return; var dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1)); tx = null; });

  /* which device is this? (used by the home page and the Download page) */
  var ua = navigator.userAgent || "";
  window.myDevice = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Windows/i.test(ua) ? "windows" : "other";
})();
